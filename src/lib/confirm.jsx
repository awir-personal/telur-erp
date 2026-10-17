import React, { createContext, useCallback, useContext, useState } from 'react';

// Pengganti window.confirm (sama seperti ConfirmDialog di app lain): dialog di dalam halaman,
// tidak membuka jendela OS. Pakai: const confirm = useConfirm(); if (!(await confirm('...'))) return;
const Ctx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { message, confirmLabel, danger, resolve }
  const confirm = useCallback((message, { confirmLabel, danger = true } = {}) =>
    new Promise((resolve) => setState({ message, confirmLabel, danger, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 dark:bg-black/60" onClick={() => close(false)}>
          <div className="card w-full max-w-sm space-y-4 p-5" role="dialog" onClick={(e) => e.stopPropagation()}>
            <p className="whitespace-pre-line text-sm">{state.message}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => close(false)}>Batal</button>
              <button type="button" autoFocus className={`flex-1 ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
                {state.confirmLabel || (state.danger ? 'Hapus' : 'Lanjutkan')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
export const useConfirm = () => useContext(Ctx);
