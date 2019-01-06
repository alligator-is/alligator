module.exports = {

  apps : [

    // First application
    {
      name      : 'alligator',
      script    : './bin.js',
      args:'start --listen "shs+tcp://[::]:81" --listen "shs+ws://[::1]:80" --logLevel 7',
      env: {
      },
      env_production : {
        NODE_ENV: 'production'
      }
    }
  ]
};
