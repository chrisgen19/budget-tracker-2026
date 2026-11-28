"use client";

import { createContext, useContext } from "react";

export interface ModalKeyboardState {
  /** Mobile sheet with the on-screen keyboard up. Always false on desktop and outside a Modal. */
  keyboardOpen: boolean;
  /** Element flush with the sheet's bottom edge (the keyboard's top while it is open), or null. */
  footerSlot: HTMLElement | null;
}

export const ModalKeyboardContext = createContext<ModalKeyboardState>({
  keyboardOpen: false,
  footerSlot: null,
});

export const useModalKeyboard = () => useContext(ModalKeyboardContext);
