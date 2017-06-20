# egg-keystone

This is a egg plugin for fetching keystone token according to the default user/password/project/domain according to the configuration.

To use this configuration, you need to make sure you also have a memcached to save the keystone token temporality. Because we don't want to generate a token everytime you need it.

## Install
Please make sure node 7.9.0 or above is install before you start.

```
$ npm i egg-keystone --save
```

## Usage
```javascript
// {app_root}/config/plugin.js
exports.keystone = {
  enable: true,
  package: 'egg-keystone'
};
exports.memcached = {
  enable: true,
  package: 'egg-memcached'
};
```

## Configuration
```javascript
// {app_root}/config/config.default.js 
exports.memcached = {
  "client": {
    "hosts": ['10.0.1.1:11211'],  // The memcached cluster list.
  }
};

exports.keystone = {
  "url": "http://10.0.1.1:35357/v3",  // Keystone endpoint.
  "username": "admin",                // Keystone admin user.
  "userId": "732407c2ee4f4f99ac6639b386c299c0", // Keystone admin user id.
  "password": "password",       // Keystone admin password
  "projectName": "admin",       // Keystone admin user's project name.
  "projectId": "cd5f1e02d9ad439abed7760afe0bd70e",  // Keystone admin user's project id.
  "cachedKey": "temp_token",    // The cached key saved in memcached.
};
```

This plugin will not require any new token unless the current one is expired.