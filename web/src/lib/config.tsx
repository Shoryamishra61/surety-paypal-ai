// Config context shared across views.

import { createContext, useContext } from 'react';
import type { SuretyConfig } from './api';

export const ConfigContext = createContext<SuretyConfig | null>(null);

export function useConfig(): SuretyConfig | null {
  return useContext(ConfigContext);
}
