/**
 * Optional Fly.io session affinity: store sessionId -> FLY_MACHINE_ID in Redis
 * so requests for a session can be replayed to the correct machine (fly-replay).
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (from Upstash Console)
 * and FLY_MACHINE_ID is set by Fly.io. When both are set, we register each new
 * session and replay requests that land on the wrong machine.
 */

const FLY_MACHINE_ID = process.env.FLY_MACHINE_ID || '';
const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const TTL_SECONDS = 86400; // 24h

const PREFIX = 'rh:machine:';

function isEnabled() {
    return Boolean(FLY_MACHINE_ID && REST_URL && REST_TOKEN);
}

/**
 * Store sessionId -> current machine. Call after creating a session on this instance.
 * @param {string} sessionId - 32-char hex session id
 * @returns {Promise<void>}
 */
async function registerSessionMachine(sessionId) {
    if (!isEnabled() || !sessionId || !/^[a-f0-9]{32}$/i.test(sessionId)) return;
    const key = PREFIX + sessionId;
    try {
        const res = await fetch(REST_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REST_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(['SET', key, FLY_MACHINE_ID, 'EX', TTL_SECONDS])
        });
        if (!res.ok) {
            console.warn(`[sessionAffinity] SET failed ${res.status} for ${sessionId}`);
        }
    } catch (e) {
        console.warn(`[sessionAffinity] register error:`, e.message);
    }
}

/**
 * Fire-and-forget registration (no await). Use when you don't want to block the request.
 * @param {string} sessionId
 */
function registerSessionMachineSync(sessionId) {
    if (!isEnabled() || !sessionId || !/^[a-f0-9]{32}$/i.test(sessionId)) return;
    registerSessionMachine(sessionId).catch(() => {});
}

/**
 * Get the machine ID that owns this session (for fly-replay).
 * @param {string} sessionId
 * @returns {Promise<string|null>} FLY_MACHINE_ID or null
 */
async function getMachineForSession(sessionId) {
    if (!isEnabled() || !sessionId || !/^[a-f0-9]{32}$/i.test(sessionId)) return null;
    const key = PREFIX + sessionId;
    try {
        const res = await fetch(REST_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REST_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(['GET', key])
        });
        if (!res.ok) return null;
        const data = await res.json();
        const machineId = data && data.result;
        return typeof machineId === 'string' ? machineId : null;
    } catch (e) {
        return null;
    }
}

module.exports = {
    isEnabled,
    registerSessionMachine,
    registerSessionMachineSync,
    getMachineForSession,
    FLY_MACHINE_ID
};
