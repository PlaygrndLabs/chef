import { feature as home } from "../features/home/index.ts";
import type { Feature } from "../shared/http.ts";

export const features: readonly Feature[] = [home];
