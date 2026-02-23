'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, type?: 'success' | 'error', action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success', action?: ToastAction) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type, action }]);
    const timeout = action ? 3000 : 1800;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, timeout);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 z-[60] flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-fade-up pointer-events-auto flex items-center gap-3 ${
                toast.type === 'error'
                  ? 'bg-danger text-white'
                  : 'bg-card border border-card-border text-foreground'
              }`}
            >
              {toast.message}
              {toast.action && (
                <button
                  onClick={() => { dismiss(toast.id); toast.action!.onClick(); }}
                  className="text-accent underline cursor-pointer pointer-events-auto whitespace-nowrap"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
