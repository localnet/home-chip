// Pure side-effect module: isolates the SDK in the test process — the one the simulated devices
// run in — from MATTER_* environment variables, process argv and the values in its own config
// file, as packages/matter/src/sdk-config.ts does for the hub. The file itself is still read:
// the SDK parses ~/.matter/config.json whatever loadConfigFile says, and a malformed one fails
// the run at the first device. It has to be evaluated before any other
// "@matter/main" import in this process, which is why device.ts imports it first; if that ever
// stops holding, the SDK throws at the first assignment rather than quietly ignoring it.
//
// The hub being isolated is not enough. The devices read their configuration from wherever the
// suite runs, so a variable exported in the shell of whoever runs it reaches them: with
// MATTER_MDNS_NETWORKINTERFACE set, they advertise on that interface alone, which is the
// confinement device.ts explains hangs a Linux run at the first discovery.
//
// Signals are taken from the SDK here too, for a different reason than the hub's. The SDK answers
// SIGTERM with a shutdown of its own, and a process whose SDK is already wedged — a device whose
// start never settled after mDNS failed — then never gets through it: SIGTERM stops ending the
// process, and whatever sent it has to escalate to SIGKILL. Left to Node, SIGTERM ends it.
//
// The storage driver is not carried over: it is the hub's durability choice, which a simulated
// device has no stake in.
//
// Like the hub's, it reaches into "@matter/nodejs", undeclared for the same reason: "@matter/main"
// pins it, and a declared version could resolve to a second copy whose `config` the SDK never
// reads.
import { config } from "@matter/nodejs/config";

config.loadProcessEnv = false;
config.loadProcessArgv = false;
config.loadConfigFile = false;
config.trapProcessSignals = false;
