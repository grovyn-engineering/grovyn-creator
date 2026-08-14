"use client";

import * as React from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquare, Plus, Send, Heart, Trash2, AtSign, MessageCircle } from "lucide-react";
import {
  ACTIONS_BY_TRIGGER,
  FIELDS_BY_TRIGGER,
  conditionOperatorSchema,
  createWorkflowRequestSchema,
  type CreateWorkflowRequest,
  type WorkflowActionType,
  type WorkflowTriggerType,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldInput,
  FieldLabel,
  FieldSelect,
  FieldTextarea,
  FormError,
} from "@/components/ui/field";
import { cn, humanize } from "@/lib/utils";

/**
 * The workflow builder.
 *
 * The organising idea is that a workflow reads as an English sentence —
 * "WHEN a comment is received, IF it contains 'price', THEN reply to it" — and
 * the layout renders that sentence literally, as three labelled steps down a
 * connected rail. Someone with no technical background should be able to read
 * their own automation back and know what it will do.
 *
 * This is why the data model is flat rather than a node graph. A canvas of
 * draggable nodes is more powerful and much harder to read; nothing V1 does
 * needs the extra power, and the readability is the actual product feature.
 */

const TRIGGERS: Array<{
  value: WorkflowTriggerType;
  label: string;
  description: string;
  icon: typeof MessageSquare;
}> = [
  {
    value: "COMMENT_RECEIVED",
    label: "Someone comments on a post",
    description: "Runs when a new comment appears on any of your posts or reels.",
    icon: MessageSquare,
  },
  {
    value: "MESSAGE_RECEIVED",
    label: "Someone sends a direct message",
    description: "Runs when your account receives a new DM.",
    icon: MessageCircle,
  },
  {
    value: "MENTION_RECEIVED",
    label: "Someone mentions you",
    description: "Runs when your account is mentioned in a comment or caption.",
    icon: AtSign,
  },
];

const ACTION_META: Record<
  WorkflowActionType,
  { label: string; description: string; icon: typeof Send; needsMessage: boolean }
> = {
  REPLY_TO_COMMENT: {
    label: "Reply to the comment",
    description: "Posts a public reply underneath the comment.",
    icon: MessageSquare,
    needsMessage: true,
  },
  SEND_DIRECT_MESSAGE: {
    label: "Send a direct message",
    description: "Sends a private DM to whoever triggered this.",
    icon: Send,
    needsMessage: true,
  },
  LIKE_COMMENT: {
    label: "Like the comment",
    description: "Adds a like to the comment. No message needed.",
    icon: Heart,
    needsMessage: false,
  },
};

/** Human wording for each operator — "contains", not "CONTAINS" or "contains_op". */
const OPERATOR_LABELS: Record<string, string> = {
  equals: "is exactly",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
};

const FIELD_LABELS: Record<string, string> = {
  "comment.text": "the comment text",
  "comment.post_id": "the post it is on",
  "comment.author_username": "the commenter's username",
  "message.text": "the message text",
  "message.sender_username": "the sender's username",
  "mention.text": "the mention text",
};

export interface WorkflowBuilderProps {
  defaultValues?: Partial<CreateWorkflowRequest>;
  onSubmit: (values: CreateWorkflowRequest) => Promise<void> | void;
  submitLabel: string;
  isSubmitting?: boolean;
  /** Rendered beside the submit button — delete, cancel, and so on. */
  secondaryActions?: React.ReactNode;
}

export function WorkflowBuilder({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting = false,
  secondaryActions,
}: WorkflowBuilderProps) {
  const form = useForm<CreateWorkflowRequest>({
    // The identical schema the API enforces. Cross-field rules — which fields a
    // trigger can read, which actions it can perform — live in the schema's
    // refinement, so the builder and the server agree by construction rather
    // than by two implementations that have to be kept in sync.
    resolver: zodResolver(createWorkflowRequestSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      triggerType: defaultValues?.triggerType ?? "COMMENT_RECEIVED",
      conditions: defaultValues?.conditions ?? [],
      actions: defaultValues?.actions ?? [
        { actionType: "REPLY_TO_COMMENT", configuration: { message: "" } },
      ],
    },
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    setError,
    formState: { errors },
  } = form;

  /*
   * `useWatch`, not `form.watch()`.
   *
   * This genuinely needs to be reactive — changing the trigger changes which
   * condition fields and actions are offered — so `getValues` is not an option
   * here. But `watch()` hands back a fresh function identity every render,
   * which makes the React Compiler skip memoizing this component entirely.
   * `useWatch` subscribes to the same value through a stable hook.
   */
  const triggerType = useWatch({ control, name: "triggerType" });

  const conditions = useFieldArray({ control, name: "conditions" });
  const actions = useFieldArray({ control, name: "actions" });

  const allowedFields = FIELDS_BY_TRIGGER[triggerType] ?? [];
  const allowedActions = ACTIONS_BY_TRIGGER[triggerType] ?? [];

  /**
   * Changing the trigger invalidates conditions and actions that the new
   * trigger cannot express — a DM trigger cannot read `comment.text` or reply
   * to a comment. Pruning them here keeps the form in a submittable state;
   * leaving them would produce a validation error pointing at a control the
   * user can no longer see.
   */
  function handleTriggerChange(next: WorkflowTriggerType) {
    setValue("triggerType", next, { shouldValidate: false });

    // `getValues`, not `watch`. Both read the current form state, but `watch`
    // is a subscription — it returns a fresh function identity on every render,
    // which the React Compiler cannot memoize safely and so bails out of
    // optimizing this whole component. `getValues` is a stable imperative read,
    // which is exactly what an event handler wants.
    const nextFields = FIELDS_BY_TRIGGER[next] ?? [];
    const keptConditions = (getValues("conditions") ?? []).filter((condition) =>
      nextFields.includes(condition.field)
    );
    setValue("conditions", keptConditions);

    const nextActions = ACTIONS_BY_TRIGGER[next] ?? [];
    const keptActions = (getValues("actions") ?? []).filter((action) =>
      nextActions.includes(action.actionType)
    );
    setValue(
      "actions",
      keptActions.length > 0
        ? keptActions
        : [{ actionType: "SEND_DIRECT_MESSAGE", configuration: { message: "" } }]
    );
  }

  async function submit(values: CreateWorkflowRequest) {
    try {
      await onSubmit(values);
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Could not save this workflow.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5" noValidate>
      {errors.root && <FormError>{errors.root.message}</FormError>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field error={errors.name?.message}>
            <FieldLabel>Workflow name</FieldLabel>
            <FieldInput placeholder="Auto-reply to price questions" {...register("name")} />
          </Field>

          <Field error={errors.description?.message}>
            <FieldLabel optional>Description</FieldLabel>
            <FieldInput placeholder="What this is for" {...register("description")} />
          </Field>
        </div>
      </Card>

      {/*
        The rail. Each step is numbered and connected by a vertical line, so the
        order of evaluation is visible rather than implied by stacking.
      */}
      <div className="space-y-3">
        <Step label="When" index={1} description="The event that starts this workflow">
          <fieldset className="space-y-2">
            <legend className="sr-only">Trigger</legend>
            {TRIGGERS.map((trigger) => {
              const Icon = trigger.icon;
              const selected = triggerType === trigger.value;

              return (
                <label
                  key={trigger.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    selected
                      ? "border-accent-500 bg-accent-50/60 ring-1 ring-accent-500"
                      : "border-border bg-surface hover:border-border-strong hover:bg-ink-50/60"
                  )}
                >
                  <input
                    type="radio"
                    value={trigger.value}
                    checked={selected}
                    onChange={() => handleTriggerChange(trigger.value)}
                    className="sr-only"
                    name="triggerType"
                  />
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      selected ? "text-accent-600" : "text-ink-400"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        selected ? "text-accent-700" : "text-ink-800"
                      )}
                    >
                      {trigger.label}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-5 text-ink-500">
                      {trigger.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </Step>

        <Step
          label="If"
          index={2}
          description="Conditions that must all be true. Leave empty to run on every event."
          optional
        >
          {conditions.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong bg-ink-50/40 px-4 py-5 text-center">
              <p className="text-[13px] text-ink-500">
                No conditions — this will run on <strong className="font-medium text-ink-700">every</strong>{" "}
                matching event.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {conditions.fields.map((field, index) => (
                <li
                  key={field.id}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-8 shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-400">
                      {index === 0 ? "If" : "And"}
                    </span>

                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)]">
                      <Field>
                        <FieldLabel className="sr-only">Field</FieldLabel>
                        <FieldSelect {...register(`conditions.${index}.field` as const)}>
                          {allowedFields.map((option) => (
                            <option key={option} value={option}>
                              {FIELD_LABELS[option] ?? option}
                            </option>
                          ))}
                        </FieldSelect>
                      </Field>

                      <Field>
                        <FieldLabel className="sr-only">Operator</FieldLabel>
                        <FieldSelect {...register(`conditions.${index}.operator` as const)}>
                          {conditionOperatorSchema.options.map((option) => (
                            <option key={option} value={option}>
                              {OPERATOR_LABELS[option] ?? humanize(option)}
                            </option>
                          ))}
                        </FieldSelect>
                      </Field>

                      <Field error={errors.conditions?.[index]?.value?.message}>
                        <FieldLabel className="sr-only">Value</FieldLabel>
                        <FieldInput
                          placeholder="price"
                          {...register(`conditions.${index}.value` as const)}
                        />
                      </Field>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-0 shrink-0"
                      onClick={() => conditions.remove(index)}
                    >
                      <Trash2 aria-hidden="true" />
                      <span className="sr-only">Remove condition {index + 1}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {conditions.fields.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() =>
                conditions.append({
                  field: allowedFields[0] ?? "comment.text",
                  operator: "contains",
                  value: "",
                })
              }
            >
              <Plus aria-hidden="true" />
              Add condition
            </Button>
          )}
        </Step>

        <Step label="Then" index={3} description="What to do. Actions run in order." isLast>
          {typeof errors.actions?.message === "string" && (
            <p role="alert" className="mb-2 text-[13px] text-danger-600">
              {errors.actions.message}
            </p>
          )}

          <ul className="space-y-2">
            {actions.fields.map((field, index) => (
              <ActionRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                watch={watch}
                setValue={setValue}
                allowedActions={allowedActions}
                messageError={actionMessageError(errors.actions?.[index])}
                onRemove={actions.fields.length > 1 ? () => actions.remove(index) : undefined}
              />
            ))}
          </ul>

          {actions.fields.length < 5 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() =>
                actions.append({
                  actionType: allowedActions[0] ?? "SEND_DIRECT_MESSAGE",
                  configuration: { message: "" },
                } as CreateWorkflowRequest["actions"][number])
              }
            >
              <Plus aria-hidden="true" />
              Add action
            </Button>
          )}
        </Step>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">{secondaryActions}</div>
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** One numbered step on the rail. */
function Step({
  label,
  index,
  description,
  optional,
  isLast,
  children,
}: {
  label: string;
  index: number;
  description: string;
  optional?: boolean;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-11">
      {/* The connector. Decorative, so hidden from assistive technology — the
          heading text already conveys the sequence. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[15px] top-9 h-[calc(100%-1rem)] w-px bg-border"
        />
      )}

      <span
        aria-hidden="true"
        className="absolute left-0 top-1 flex size-8 items-center justify-center rounded-full border border-border bg-surface text-[12px] font-semibold text-ink-500"
      >
        {index}
      </span>

      <div className="mb-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-900">
          {label}
          {optional && (
            <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-ink-400">
              optional
            </span>
          )}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-500">{description}</p>
      </div>

      {children}
    </div>
  );
}

type ActionRowProps = {
  index: number;
  control: ReturnType<typeof useForm<CreateWorkflowRequest>>["control"];
  register: ReturnType<typeof useForm<CreateWorkflowRequest>>["register"];
  watch: ReturnType<typeof useForm<CreateWorkflowRequest>>["watch"];
  setValue: ReturnType<typeof useForm<CreateWorkflowRequest>>["setValue"];
  allowedActions: readonly WorkflowActionType[];
  messageError?: string;
  onRemove?: () => void;
};

/**
 * Pulls the message error out of React Hook Form's error tree.
 *
 * `actions` is a discriminated union, so RHF's inferred error type is a union
 * of per-variant shapes and cannot be indexed structurally. Narrowing here with
 * a couple of runtime checks keeps that awkwardness in one small function
 * rather than spreading a cast through the component.
 */
function actionMessageError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const configuration = (error as { configuration?: unknown }).configuration;
  if (!configuration || typeof configuration !== "object") return undefined;
  const message = (configuration as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  const text = (message as { message?: unknown }).message;
  return typeof text === "string" ? text : undefined;
}

function ActionRow({
  index,
  control,
  register,
  watch,
  setValue,
  allowedActions,
  messageError,
  onRemove,
}: ActionRowProps) {
  const actionType = watch(`actions.${index}.actionType`) as WorkflowActionType;
  const meta = ACTION_META[actionType];
  const Icon = meta?.icon ?? Send;

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-2 size-4 shrink-0 text-ink-400" aria-hidden="true" />

        <div className="min-w-0 flex-1 space-y-2.5">
          <Field>
            <FieldLabel className="sr-only">Action {index + 1}</FieldLabel>
            <Controller
              control={control}
              name={`actions.${index}.actionType` as const}
              render={({ field }) => (
                <FieldSelect
                  value={field.value}
                  onChange={(event) => {
                    const next = event.target.value as WorkflowActionType;
                    field.onChange(next);
                    // Configuration is discriminated by actionType, so it has
                    // to be reset to the shape the new type expects — carrying
                    // a stale `message` onto LIKE_COMMENT would fail schema
                    // validation on submit with a confusing message.
                    setValue(
                      `actions.${index}.configuration` as const,
                      (ACTION_META[next].needsMessage
                        ? { message: "" }
                        : {}) as never
                    );
                  }}
                >
                  {allowedActions.map((option) => (
                    <option key={option} value={option}>
                      {ACTION_META[option].label}
                    </option>
                  ))}
                </FieldSelect>
              )}
            />
          </Field>

          {meta?.needsMessage ? (
            <Field error={messageError}>
              <FieldLabel className="sr-only">Message</FieldLabel>
              <FieldTextarea
                rows={2}
                placeholder="Hi {{username}} — sending you the details now!"
                {...register(`actions.${index}.configuration.message` as never)}
              />
              <FieldDescription>
                Use <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px]">
                  {"{{username}}"}
                </code>{" "}
                to insert whoever triggered this.
              </FieldDescription>
            </Field>
          ) : (
            <p className="text-[12.5px] text-ink-500">{meta?.description}</p>
          )}
        </div>

        {onRemove && (
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            <span className="sr-only">Remove action {index + 1}</span>
          </Button>
        )}
      </div>
    </li>
  );
}
