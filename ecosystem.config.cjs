/**
 * PM2 process configuration.
 *
 * Runs the web app and the send worker as two managed background services.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup          <- survives a server reboot
 *
 * Useful afterwards:
 *   pm2 status                    what is running
 *   pm2 logs azkal-worker         watch the worker send
 *   pm2 restart azkal-worker      after changing settings or .env
 *   pm2 stop azkal-worker         halt sending, leave the site up
 */
module.exports = {
  apps: [
    {
      name: "azkal-web",
      script: "npm",
      args: "start",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "600M",
      env: { NODE_ENV: "production", PORT: 3001 },
      error_file: "./logs/web-error.log",
      out_file: "./logs/web-out.log",
      time: true,
    },
    {
      name: "azkal-worker",
      // Point straight at the tsx binary rather than going through npx.
      // npx spawns a child process, and PM2 only captures output from the
      // process it launched directly, so the worker's log was going nowhere.
      script: "./node_modules/.bin/tsx",
      args: "scripts/worker.ts",
      cwd: __dirname,
      // Fork, not cluster. Cluster mode exists to run several copies of a web
      // server across CPU cores. Several copies of a send worker would be
      // several processes claiming from the same queue. Note that setting
      // "instances" at all is what pushes PM2 into cluster mode, so it is
      // deliberately absent here.
      exec_mode: "fork",
      autorestart: true,
      // Deliberately slow restart. If the worker is crash-looping, something is
      // wrong and hammering the database or a mail server makes it worse.
      restart_delay: 10_000,
      max_restarts: 20,
      min_uptime: "30s",
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      time: true,
    },
  ],
};
