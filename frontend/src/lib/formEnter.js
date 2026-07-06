const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([disabled]):not([type="checkbox"]), select:not([disabled]), textarea:not([disabled])';

export function getScopeFields(scope) {
  return [...scope.querySelectorAll(FIELD_SELECTOR)].filter((el) => {
    if (el.type === "hidden" || el.disabled) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  });
}

/** Enter moves to the next field; on the last field, submits the form or clicks the group button. */
export function handleFormEnterKeyDown(event) {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (!target.matches(FIELD_SELECTOR)) return;

  const scope = target.closest("form, [data-enter-group]");
  if (!scope) return;

  event.preventDefault();
  const fields = getScopeFields(scope);
  const idx = fields.indexOf(target);
  if (idx === -1) return;

  if (idx < fields.length - 1) {
    fields[idx + 1].focus();
    if (typeof fields[idx + 1].select === "function") {
      fields[idx + 1].select();
    }
    return;
  }

  if (scope.tagName === "FORM") {
    if (typeof scope.requestSubmit === "function") {
      scope.requestSubmit();
    } else {
      scope.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
    return;
  }

  const btn = scope.querySelector("button:not([disabled])");
  btn?.click();
}
