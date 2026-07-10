import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  createElement,
} from "react";

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

export type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

export type ToastContextValue = {
  /** The toast currently visible to the user, or null when the queue is empty. */
  current: Toast | null;
  /** Push a new toast onto the tail of the queue. */
  push: (input: ToastInput) => string;
  /** Dismiss the visible toast immediately and advance the queue. */
  dismiss: (id?: string) => void;
  /** Reset queue to empty (used by tests and route changes). */
  clear: () => void;
};

const DEFAULT_DURATION_MS = 3200;

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Single global toast queue. Renders at most one toast at a time; the next toast
 * only appears after the visible one is dismissed (either by user action or by
 * the auto-dismiss timer). Reduced-motion handling lives in <Toast />.
 */
export function ToastProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback((id?: string) => {
    clearTimer();
    setQueue((q) => {
      if (q.length === 0) return q;
      if (id !== undefined && q[0]?.id !== id) return q;
      return q.slice(1);
    });
  }, [clearTimer]);

  const push = useCallback((input: ToastInput): string => {
    const toast: Toast = {
      id: nextId(),
      message: input.message,
      tone: input.tone ?? "info",
      durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
    };
    setQueue((q) => [...q, toast]);
    return toast.id;
  }, []);

  const clear = useCallback(() => {
    clearTimer();
    setQueue([]);
  }, [clearTimer]);

  const current = queue[0] ?? null;

  // Auto-advance: when a toast becomes current, schedule its dismissal.
  useEffect(() => {
    if (!current) {
      clearTimer();
      return;
    }
    clearTimer();
    const id = current.id;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dismiss(id);
    }, current.durationMs);
    return clearTimer;
  }, [clearTimer, current, dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({ current, push, dismiss, clear }),
    [clear, current, dismiss, push],
  );

  return createElement(ToastContext.Provider, { value }, children);
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return value;
}

/** Test helper — pure-logic reducer-free queue useful for unit tests. */
export function __advanceQueueForTest(queue: Toast[], action: { type: "push"; toast: Toast } | { type: "dismiss"; id?: string }): Toast[] {
  if (action.type === "push") return [...queue, action.toast];
  if (queue.length === 0) return queue;
  if (action.id !== undefined && queue[0]?.id !== action.id) return queue;
  return queue.slice(1);
}
