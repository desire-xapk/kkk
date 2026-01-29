// Dioptimize Cloudflare Worker
// Handles user authentication and active user tracking

const ADMIN_USERNAME = 'admin0707';

// In-memory storage for users (resets on worker restart)
// For production, use Durable Objects or KV
let activeUsers = new Map();

// Pending notifications for users
let pendingNotifications = new Map();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle CORS preflight
function handleOptions() {
  return new Response(null, { headers: corsHeaders });
}

// JSON response helper
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Clean up inactive users (not seen in last 10 seconds)
function cleanupInactiveUsers() {
  const now = Date.now();
  const timeout = 10000; // 10 seconds
  
  for (const [username, data] of activeUsers.entries()) {
    if (now - data.lastSeen > timeout) {
      activeUsers.delete(username);
    }
  }
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    // Clean up inactive users on each request
    cleanupInactiveUsers();

    try {
      // Login endpoint
      if (path === '/login' && request.method === 'POST') {
        const { username } = await request.json();
        
        if (!username || typeof username !== 'string' || username.trim() === '') {
          return jsonResponse({ success: false, error: 'Invalid username' }, 400);
        }

        const trimmedUsername = username.trim();
        const isAdmin = trimmedUsername === ADMIN_USERNAME;

        // If not admin, add to active users
        if (!isAdmin) {
          activeUsers.set(trimmedUsername, {
            username: trimmedUsername,
            lastSeen: Date.now(),
            loginTime: Date.now(),
          });
        }

        return jsonResponse({ 
          success: true, 
          isAdmin,
          username: trimmedUsername 
        });
      }

      // Heartbeat endpoint - updates user's last seen time
      if (path === '/heartbeat' && request.method === 'POST') {
        const { username } = await request.json();
        
        if (!username) {
          return jsonResponse({ success: false, error: 'Username required' }, 400);
        }

        if (activeUsers.has(username)) {
          activeUsers.get(username).lastSeen = Date.now();
        } else {
          activeUsers.set(username, {
            username,
            lastSeen: Date.now(),
            loginTime: Date.now(),
          });
        }

        return jsonResponse({ success: true });
      }

      // Logout endpoint
      if (path === '/logout' && request.method === 'POST') {
        try {
          // Read body as text first (works for both fetch and sendBeacon)
          const text = await request.text();
          if (text) {
            const { username } = JSON.parse(text);
            if (username) {
              activeUsers.delete(username);
            }
          }
        } catch (e) {
          console.error('Logout parse error:', e);
        }

        return jsonResponse({ success: true });
      }

      // Get active users (for admin panel)
      if (path === '/users' && request.method === 'GET') {
        const users = Array.from(activeUsers.values()).map(user => ({
          username: user.username,
          lastSeen: user.lastSeen,
          loginTime: user.loginTime,
        }));

        return jsonResponse({ 
          success: true, 
          users,
          count: users.length 
        });
      }

      // Send notification to a user (admin only)
      if (path === '/notify' && request.method === 'POST') {
        const { username } = await request.json();
        
        if (!username) {
          return jsonResponse({ success: false, error: 'Username required' }, 400);
        }

        if (activeUsers.has(username)) {
          pendingNotifications.set(username, { 
            type: 'sound',
            timestamp: Date.now() 
          });
          return jsonResponse({ success: true });
        }
        
        return jsonResponse({ success: false, error: 'User not found' }, 404);
      }

      // Send notification to all users (admin only)
      if (path === '/notify-all' && request.method === 'POST') {
        let count = 0;
        for (const [username] of activeUsers.entries()) {
          pendingNotifications.set(username, { 
            type: 'sound',
            timestamp: Date.now() 
          });
          count++;
        }
        return jsonResponse({ success: true, notified: count });
      }

      // Check for pending notifications (called by clients)
      if (path === '/check-notification' && request.method === 'POST') {
        const { username } = await request.json();
        
        if (!username) {
          return jsonResponse({ success: false, error: 'Username required' }, 400);
        }

        if (pendingNotifications.has(username)) {
          const notification = pendingNotifications.get(username);
          pendingNotifications.delete(username);
          return jsonResponse({ success: true, hasNotification: true, notification });
        }
        
        return jsonResponse({ success: true, hasNotification: false });
      }

      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', activeUsers: activeUsers.size });
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};
