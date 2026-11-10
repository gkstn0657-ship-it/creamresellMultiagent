import {createBridge} from './bridge.mjs';
import {ensureConfig} from './local-config.mjs';
const {key} = ensureConfig();
const bridge = createBridge({key});
bridge.server.on('error', () => { console.error('NO1_BRIDGE_START_FAILED'); process.exitCode = 1; });
bridge.server.listen(8871, '127.0.0.1', () => console.log('No1 background bridge ready on loopback port 8871. No browser connected automatically.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await bridge.close(); process.exit(); });
