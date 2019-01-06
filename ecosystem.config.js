module.exports = {

  apps : [

    // First application
    {
      name      : 'alligator',
      script    : './bin.js',
      args:'start --listen "shs+tcp://[::]:81" --listen "shs+ws://[::1]:80"',
      env: {
      },
      env_production : {
        NODE_ENV: 'production'
      }
    }
  ]
};
