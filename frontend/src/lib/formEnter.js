const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([disabled]):not([type="checkbox"]):not([type="radio"]), select:not([disabled])';

/**
 * Enter performs the form's action, the same as pressing its primary button.
 *
 * Browsers already do this for a form holding an enabled submit button, so the
 * handler stays out of the way there and only steps in where implicit
 * submission does not apply: a form whose action lives on a non-submit button,
 * or a [data-enter-group] container that is not a <form> at all.
 *
 * Textareas keep Enter for newlines, and modifier or IME-composition presses
 * are left alone.
 */
export function handleFormEnterKeyDown(event) {
  if (event.key !== "Enter") return;
  if (event.isComposing || event.keyCode === 229) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;

  const target = event.target;
  if (!target || target.tagName === "TEXTAREA") return;
  if (typeof target.matches !== "function" || !target.matches(FIELD_SELECTOR)) return;

  const scope = target.closest("form, [data-enter-group]");
  if (!scope) return;

  if (scope.tagName === "FORM") {
    // An enabled submit control means the browser submits on its own.
    if (scope.querySelector('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])')) {
      return;
    }
    event.preventDefault();
    if (typeof scope.requestSubmit === "function") scope.requestSubmit();
    else scope.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    return;
  }

  event.preventDefault();
  // Priority order matters, so query each in turn: a selector list would just
  // return whichever button comes first in the DOM.
  const btn =
    scope.querySelector("button[data-enter-default]:not([disabled])") ||
    scope.querySelector('button:not([type="button"]):not([type="reset"]):not([disabled])') ||
    scope.querySelector("button:not([disabled])");
  if (btn) btn.click();
}
