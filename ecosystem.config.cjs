/**
 * PM2 process configuration.
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
      // tsx is the interpreter, the .ts file is the script. PM2 then simply
      // runs "tsx scripts/worker.ts", which is what works by hand.
      //
      // Two things this avoids. Pointing PM2 at the tsx binary as the script
      // fails, because fork mode require()s the script and the tsx CLI is an
      // ES module. Running "node --import tsx" fails too, because the node on
      // this server's PATH is 20.5.1 and --import needs 20.6 or newer.
      // Letting tsx be the interpreter sidesteps both.
      script: "scripts/worker.ts",
      interpreter: "./node_modules/.bin/tsx",
      cwd: __dirname,
      // Fork, not cluster. Cluster mode exists to run several copies of a web
      // server across CPU cores. Several copies of a send worker would be
      // several processes claiming from the same queue. Setting "instances" at
      // all is what pushes PM2 into cluster mode, so it is deliberately absent.
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
