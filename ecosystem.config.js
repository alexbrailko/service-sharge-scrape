// PM2 config for the scraper.
// Deploy this file to /var/www/service-sharge-scrape, then:
//   pm2 delete scraper            # remove the old ad-hoc process
//   pm2 start ecosystem.config.js # start with these settings
//   pm2 save                      # persist across reboots
module.exports = {
  apps: [
    {
      name: 'scraper',
      script: 'dist/index.js',
      // cwd defaults to this file's directory (/var/www/service-sharge-scrape).
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Stop infinite restart storms if it crashes on boot.
      max_restarts: 5,
      min_uptime: '60s',
      restart_delay: 5000,
      // Give gracefulShutdown() time to close Chrome before PM2 sends SIGKILL.
      // Must be longer than the close logic takes; pairs with the SIGTERM handler.
      kill_timeout: 20000,
      // Backstop for NODE-side leaks (cheerio/arrays). NOTE: this does NOT catch
      // Chrome memory — Chrome runs as separate processes, so the real Chrome fix
      // is the graceful-shutdown + killStrayChrome code, not this number.
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
