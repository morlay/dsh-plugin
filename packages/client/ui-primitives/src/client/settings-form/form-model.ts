// 与 vendor/deepseek-harness/packages/client/ui-primitives/src/settings-form/form-model.ts 逐行对应；
// 改这里之前先看上游是否也改了同一处（上游只读）。

// The staged form model behind a plugin's settings page: a card stages what the user types and writes it only on
// save, and a field is marked overridden by its user-layer presence rather than by a value comparison.

import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";

// What the model reads of one Host entry's form.
export interface SettingsFormScopeSnapshot<T> {
  // `ready` while the Host serves the entry to this client; the form renders nothing otherwise.
  status: "loading" | "ready" | "unavailable";
  // Last accepted schema-resolved section; undefined before the first acceptance.
  value: T | undefined;
  // Composition layer the value resolves over: what a field reverts to once cleared.
  base: unknown;
  // Raw user layer as stored; a field's PRESENCE here is what marks it overridden.
  user: unknown;
  // Whether the Host document accepts writes.
  writable: boolean;
  // Revision the snapshot was read at; a save fences its mutation with the revision its drafts started from.
  revision: number | undefined;
}

// One path edit a save sends, as the shared configuration form's `mutate` accepts it.
export type SettingsFormPathOp =
  | { op: "set"; path: readonly string[]; value: unknown }
  | { op: "unset"; path: readonly string[] };

// The entry form the model stages over: the reads and the atomic write of the form `ui-settings` shares per Host entry.
export interface SettingsFormScope<T> {
  getSnapshot(): SettingsFormScopeSnapshot<T>;
  // Observe snapshot replacements.
  subscribe(listener: () => void): () => void;
  // Apply ordered field edits in one revision-fenced write; resolves after any recovery read.
  mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean>;
}

// The write one field's staged text performs when the card is saved.
export type SettingsFieldWrite = { kind: "set"; value: unknown } | { kind: "clear" };

// How one section field converts between its stored value and its draft text.
export interface SettingsFieldSpec {
  // Field name inside the namespace section.
  field: string;
  // Render a stored value as draft text; the empty string when the section carries none.
  format: (value: unknown) => string;
  // The write this draft text stages, or undefined when the text is not a value this field accepts (blocks the save).
  parse: (text: string) => SettingsFieldWrite | undefined;
}

// A control whose value is written outside the settings section: a credential literal never rides a response, so its
// draft is blank until typed and a blank draft writes nothing.
export interface SettingsSecretSpec {
  // Field name addressing this control inside the card's form.
  field: string;
  // Write the staged text; resolves to whether the Host accepted it.
  write: (text: string) => Promise<boolean>;
}

// One field as a card's control renders it.
export interface SettingsFieldState {
  // Draft text the control renders.
  text: string;
  // Whether saving would leave a user-layer entry for this field; a staged edit answers for itself.
  overridden: boolean;
  // Whether the draft is not a value this field accepts, which blocks saving.
  invalid: boolean;
}

// Form state every plugin card shares.
export interface SettingsFormShell {
  // False while the namespace is not served to this client; the card renders nothing.
  available: boolean;
  // Whether the Host document accepts writes.
  writable: boolean;
  // Whether the form holds edits that a save would write.
  dirty: boolean;
  // Whether any staged draft is invalid, which blocks the save.
  invalid: boolean;
  // Whether a save is crossing the wire.
  saving: boolean;
  // Whether the last save did not land as staged; cleared by the next edit or save.
  failed: boolean;
}

// The write actions every plugin card's slot entry injects.
export interface SettingsFormActions {
  // Stage draft text for one field.
  edit: (field: string, text: string) => void;
  // Stage a clear, so saving lets the field re-inherit the composition layer.
  resetField: (field: string) => void;
  // Write every staged edit, then re-seed from what the Host accepted.
  save: () => void;
  // Drop every staged edit.
  discard: () => void;
}

// One field's staged edit.
interface StagedEdit {
  // Draft text the control renders.
  text: string;
  // True when this edit clears the field whatever text it shows.
  clear: boolean;
}

// One staged edit resolved into the write a save performs.
interface PlannedWrite {
  // Field this entry writes.
  field: string;
  // Perform the write and report whether the Host holds the staged value afterwards.
  run?: () => Promise<boolean>;
  op?: SettingsFormPathOp;
}

// A whole-number field: an empty draft clears the field, any other draft that is not a finite number blocks the save.
export function settingsNumberField(field: string): SettingsFieldSpec {
  return {
    field,
    // A section that carries no number for this field renders empty rather than as a value nobody chose.
    format: (value) => (typeof value === "number" ? String(value) : ""),
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? { kind: "set", value: parsed } : undefined;
    },
  };
}

// A free-text field: an empty draft clears the field, so emptying the control and saving is the same as resetting it.
export function settingsTextField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === "string" ? value : ""),
    parse: (text) => {
      const trimmed = text.trim();
      return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
    },
  };
}

// Stages one card's edits over one settings namespace and writes them on save. The form publishes through a snapshot
// store because slot components read through a snapshot selector while both the scope and the drafts change underneath.
export class SettingsFormModel<T> {
  private readonly specs: Map<string, SettingsFieldSpec>;
  private readonly secretSpecs: Map<string, SettingsSecretSpec>;
  private readonly staged = new Map<string, StagedEdit>();
  private readonly listeners = new Set<() => void>();
  private baseline: SettingsFormScopeSnapshot<T> | undefined;
  private readonly unsubscribe: () => void;
  private saving = false;
  private failed = false;

  constructor(
    private readonly scope: SettingsFormScope<T>,
    specs: SettingsFieldSpec[],
    secrets: SettingsSecretSpec[] = [],
  ) {
    this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]));
    this.unsubscribe = scope.subscribe(() => {
      this.publish();
    });
  }

  // Publish a projection of this form, rebuilt whenever the scope or a draft changes.
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project());
    this.listeners.add(() => {
      store.set(project());
    });
    return store;
  }

  // Read the card-level state: what the Host serves, and what a save would do.
  shell(): SettingsFormShell {
    const snapshot = this.scope.getSnapshot();
    const plan = this.plan();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined && item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    };
  }

  // Read one control's state: draft text, whether a save would leave an override, and whether it is invalid.
  field(field: string): SettingsFieldState {
    const staged = this.staged.get(field);
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? "", overridden: false, invalid: false };
    }
    const spec = this.spec(field);
    if (staged === undefined) {
      return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false,
      };
    }
    const write = staged.clear ? { kind: "clear" as const } : spec.parse(staged.text);
    return {
      text: staged.text,
      overridden: write?.kind === "set",
      invalid: write === undefined,
    };
  }

  // Build the edit, reset, save, and discard actions bound to this form.
  actions(): SettingsFormActions {
    return {
      edit: (field, text) => {
        this.stage(field, { text, clear: false });
      },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true });
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return;
        this.staged.clear();
        this.baseline = undefined;
        this.failed = false;
        this.publish();
      },
    };
  }

  // Write every staged edit, then re-seed from what the Host accepted: the outcome is read back rather than predicted
  // (the Host is the only authority), and a save that did not land keeps its drafts so the user can correct them.
  async save(): Promise<void> {
    const plan = this.plan();
    if (
      !plan.length ||
      this.saving ||
      !this.scope.getSnapshot().writable ||
      plan.some((item) => item.run === undefined && item.op === undefined)
    )
      return;
    this.saving = true;
    this.failed = false;
    this.publish();
    try {
      const ops = plan.flatMap((item) => (item.op === undefined ? [] : [item.op]));
      let landed = !ops.length || (await this.scope.mutate(ops, this.baseline?.revision));
      if (!landed) {
        this.failed = true;
        return;
      }
      for (const item of plan) if (item.run) landed = (await item.run()) && landed;
      if (landed) {
        this.staged.clear();
        this.baseline = undefined;
      }
      this.failed = !landed;
    } catch {
      this.failed = true;
    } finally {
      this.saving = false;
      this.publish();
    }
  }

  // Release the form's accepted-value subscription.
  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  // Every staged edit a save would write; an entry whose draft its field rejects carries no write (the form stays
  // dirty, and the save refuses rather than dropping the edit).
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = [];
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field);
      if (secret !== undefined) {
        const value = staged.text.trim();
        if (value !== "") plan.push({ field, run: () => secret.write(value) });
        continue;
      }
      const spec = this.spec(field);
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { op: "unset", path: [field] } });
        continue;
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue;
      const write = spec.parse(staged.text);
      if (write === undefined) plan.push({ field });
      else if (write.kind === "clear") plan.push({ field, op: { op: "unset", path: [field] } });
      else plan.push({ field, op: { op: "set", path: [field], value: write.value } });
    }
    return plan;
  }

  private stage(field: string, edit: StagedEdit): void {
    this.baseline ??= this.scope.getSnapshot();
    this.staged.set(field, edit);
    this.failed = false;
    this.publish();
  }

  private spec(field: string): SettingsFieldSpec {
    const spec = this.specs.get(field);
    // Every call site names a field this card declared; a missing one is a wiring mistake that must not become a
    // silently inert control.
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`);
    return spec;
  }

  private snapshotOf(): SettingsFormScopeSnapshot<T> {
    return this.scope.getSnapshot();
  }

  private sectionValue(field: string): unknown {
    return (this.snapshotOf().value as Record<string, unknown> | undefined)?.[field];
  }

  private baseValue(field: string): unknown {
    return (this.snapshotOf().base as Record<string, unknown> | undefined)?.[field];
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined;
  }

  private stored(field: string): boolean {
    const user = this.userLayer();
    return user !== undefined && Object.hasOwn(user, field);
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
