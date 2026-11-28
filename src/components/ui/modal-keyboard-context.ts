"use client";

import { createContext, useContext } from "react";

/** Mobile sheet with the on-screen keyboard up. Always false on desktop and outside a Modal. */
export const ModalKeyboardContext = createContext(false);

export const useModalKeyboardOpen = () => useContext(ModalKeyboardContext);

/**
 * Put on a text field to change what the sheet keeps in view while the keyboard is up: instead
 * of centring the field, the sheet scrolls the element with this id to the bottom of the visible
 * area, so everything between the field and that element shows together.
 */
export const KEYBOARD_REVEAL_UNTIL_ATTR = "data-keyboard-reveal-until";
