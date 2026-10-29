import { createContext, useContext } from 'react';
import type { StageDef } from './types';

/** The signed-in workspace's pipeline, provided once by the console. */
export const StagesContext = createContext<StageDef[]>([]);
export const useStages = () => useContext(StagesContext);
