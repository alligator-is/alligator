module.exports = {

  apps : [

    // First application
    {
      name      : 'alligator',
      script    : './bin.js',
      wait_ready:true,
      kill_timeout: 60000,
      args:'start --listen "shs+tcp://[::]:81" --listen "shs+ws://[::]:80"',
      env: {
      },
      env_production : {
        NODE_ENV: 'production'
      }
    }
  ]
};
