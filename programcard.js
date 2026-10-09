// Plan tab card: edit the program dates (stored in the plan overrides).
import { PROGRAM } from "./data.js";
import {
  PROGRAM_FIELDS, PROGRAM_LABELS, PROGRAM_NUM_FIELDS, loadPlan, savePlan, effectiveProgram,
  validateProgramInput, setProgramOverrides, resetProgram,
} from "./planstore.js";
import { el as h } from "./dom.js";

export function programCard(rerender) {
  const plan = loadPlan();
  const eff = effectiveProgram(plan);
  const edited = Object.keys(plan.program).length > 0;
  const inputs = {};
  const errBox = h("div", { class: "form-errors", id: "program-errors", role: "alert", "aria-live": "polite" });
  const fields = PROGRAM_FIELDS.map((f) => {
    const num = f in PROGRAM_NUM_FIELDS;
    const input = h("input", {
      id: `program-${f}`, "data-field": f, type: num ? "number" : "date", value: String(eff[f]),
      ...(num ? { inputmode: "numeric", min: String(PROGRAM_NUM_FIELDS[f].min), max: String(PROGRAM_NUM_FIELDS[f].max), step: "1" } : {}),
    });
    inputs[f] = input;
    return h("label", { class: plan.program[f] !== undefined ? "changed" : "" }, [PROGRAM_LABELS[f], input]);
  });

  const read = () => Object.fromEntries(PROGRAM_FIELDS.map((f) => [f, inputs[f].value]));
  const showErrors = (errors) => {
    errBox.textContent = "";
    for (const [f, msg] of Object.entries(errors)) {
      errBox.appendChild(h("p", {}, msg));
      inputs[f].setAttribute("aria-invalid", "true");
    }
  };

  return h("div", { class: "card", id: "plan-program" }, [
    h("h2", {}, "Program dates"),
    h("p", { class: "muted" }, "When your plan and medicine courses start and end. Today, Meds, Insights and reminders all follow these dates."),
    edited ? h("span", { class: "chip plan-custom" }, "Edited") : h("span", { class: "chip" }, "Using program defaults"),
    h("div", { class: "plan-form" }, fields),
    h("p", { class: "muted trk-small" }, "The weekly medicine runs on the weekday of its first-dose date."),
    errBox,
    h("div", { class: "actions-row" }, [
      h("button", {
        class: "primary", id: "program-save", type: "button",
        onclick: () => {
          Object.values(inputs).forEach((i) => i.removeAttribute("aria-invalid"));
          const v = validateProgramInput(read());
          if (!v.ok) { showErrors(v.errors); return; }
          savePlan(setProgramOverrides(loadPlan(), v.value));
          rerender();
        },
      }, "Save dates"),
      edited ? h("button", {
        class: "secondary", id: "program-reset", type: "button",
        onclick: () => { savePlan(resetProgram(loadPlan())); rerender(); },
      }, `Back to defaults (${PROGRAM.planStart})`) : null,
    ]),
  ]);
}
