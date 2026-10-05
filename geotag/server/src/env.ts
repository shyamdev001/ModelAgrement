// Imported first by server.ts so that settings from .env exist before any other module reads them.
try {
  process.loadEnvFile();
} catch {
  // no .env file: settings come from the host
}
