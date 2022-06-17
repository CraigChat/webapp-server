module.exports = {
  apps: [
    {
      name: 'Craig Webapp Server',
      script: 'dist/index.js',
      wait_ready: true,
      kill_timeout: 3000,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
