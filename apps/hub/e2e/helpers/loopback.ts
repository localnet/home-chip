/**
 * The loopback interface, named differently by each system: `lo0` on the BSDs and macOS, `lo`
 * on Linux and everywhere else this runs.
 *
 * Both sides of a run are pinned to it — the hub through its config file, the devices through the
 * SDK environment — so a suite neither advertises its simulated devices on the network it happens
 * to be on nor pairs with something already there. Matter carries mDNS over IPv6 multicast, which
 * the loopback serves within one host.
 */
export const LOOPBACK = process.platform === "darwin" ? "lo0" : "lo";
