// Vercel entry point: every /api/* request is handed to the same Express app used in development.
import { createApp } from '../server/src/app';

export default createApp();
