import { RefObject, useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  backdropRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousActive = document.activeElement as HTMLElement | null;
    const activeDialog = dialog;
    const appRoot = document.getElementById("root");
    const siblings = appRoot
      ? Array.from(appRoot.children)
      : [];

    siblings.forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      child.setAttribute("aria-hidden", "true");
      if ("inert" in child) {
        child.inert = true;
      }
    });
    document.body.classList.add("modal-open");

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((element) => !element.hasAttribute("disabled"));
    (focusables[0] ?? dialog).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = Array.from(
        activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => !element.hasAttribute("disabled"));
      if (items.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (!activeDialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(event: FocusEvent) {
      if (activeDialog.contains(event.target as Node)) return;
      const items = Array.from(
        activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => !element.hasAttribute("disabled"));
      (items[0] ?? activeDialog).focus();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      siblings.forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        child.removeAttribute("aria-hidden");
        if ("inert" in child) {
          child.inert = false;
        }
      });
      document.body.classList.remove("modal-open");
      previousActive?.focus?.();
    };
  }, [backdropRef, dialogRef, open]);
}
