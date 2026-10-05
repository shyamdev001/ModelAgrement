import './env';
import { createApp } from './app';

const port = Number(process.env.PORT) || 4000;
const server = createApp().listen(port, () => console.log(`Geotag photo server listening on port ${port}`));
// A request that takes longer than this is cut off rather than left hanging.
server.requestTimeout = 60_000;
