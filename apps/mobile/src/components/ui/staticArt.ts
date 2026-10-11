import { createContext, useContext } from 'react';

/**
 * True inside a picture of a screen (the Welcome phone previews). Decorative motion there is a
 * waste: it is tiny, hidden from screen readers and sits on a page that already has a hero loop.
 * BreathingGlow and CountUp read it and stay still; screens that draw Pip pass `float={!useStaticArt()}`.
 */
export const StaticArtContext = createContext(false);

export const useStaticArt = () => useContext(StaticArtContext);
