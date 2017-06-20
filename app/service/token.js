'use strict';

/**
 * Service to fetch token either in memory or by username.
 */

'use strict';

module.exports = app => {
  class Server extends app.Service {
    constructor(ctx) {
      super(ctx);
      this.config = app.config.keystone;
    }
    async getToken() {
      let obj = await this.ctx.app.memcached.get(this.config.cachedKey);

      if (obj) {
        const last = Date.parse(obj.expires_at);
        if (last - Date.now() < 1800000) {
          obj = null;
        }
      }
      if (!obj) {
        // Do the login action.
        const {
          url,
          userId,
          password,
          projectId
        } = this.config;
        const result = await this.ctx.curl(`${url}/auth/tokens`, {
          dataType: 'json',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          data: {
            "auth": {
              "identity": {
                "methods": [
                  "password"
                ],
                "password": {
                  "user": {
                    "id": userId,
                    "password": password
                  }
                }
              },
              "scope": {
                "project": {
                  "id": projectId
                }
              }
            }
          }
        });
        const token = result.data.token;
        if (result.headers && result.headers['x-subject-token']) {
          token.token = result.headers['x-subject-token'];
        }
        const catalog = {};

        token.catalog.forEach(ca => {
          const name = ca.name;
          catalog[name] = {};

          const endpoints = ca.endpoints;
          endpoints.forEach(endpoint => {
            if (endpoint.interface === 'public') {
              if (name === 'neutron' && !/\/2.0/.test(endpoint.url)) {
                catalog[name][endpoint.region_id] = `${endpoint.url}/v2.0`
              } else if (name === 'glance' && !/\/v2/.test(endpoint.url)) {
                catalog[name][endpoint.region_id] = `${endpoint.url}/v2`
              } else {
                catalog[name][endpoint.region_id] = endpoint.url;
              }
            }
          });
        });
        token.catalog = catalog;
        await this.ctx.app.memcached.set(this.config.cachedKey, token);
        obj = token;
      }
      return {
        "token": obj.token,
        "endpoint": obj.catalog,
      }
    }

    formatEndpoint(catalogs) {
      catalogs.forEach(catalog => {
        if (catalog.name === 'neutron') {
          catalog.endpoints.forEach(endpoint => {
            Object.keys(endpoint).forEach(key => {
              if (/URL$/.test(key)) {
                endpoint[key] = `${endpoint[key]}/v2.0`;
              }
            });
          })
        } else if (catalog.name === 'glance') {
          catalog.endpoints.forEach(endpoint => {
            Object.keys(endpoint).forEach(key => {
              if (/URL$/.test(key)) {
                endpoint[key] = `${endpoint[key]}/v2`;
              }
            });
          })
        }
      });
    }

    /**
     * Scane the current endpoint. If we don't have charge endpoint, we will create one.
     */
    async initEndpoint() {
      const token = await this.getToken();
      const result = await this.ctx.curl(`${this.config.url}/services`, {
        dataType: 'json',
        headers: {
          'X-Auth-Token': token.token
        }
      });

      const services = result.data;
      const config = this.ctx.app.config.charge.catalog;
      let found = null;
      services.services.some(service => {
        if (service.name === config.name) {
          found = service;
          return true;
        }
        return false;
      });

      // console.log('found', services.services);
      if (!found) {
        // Create a new service:
        const res = await this.ctx.curl(`${this.config.url}/services`, {
          dataType: 'json',
          headers: {
            'X-Auth-Token': token.token,
          },
          data: {
            "service": {
              "type": config.type,
              "name": config.name,
              "description": "Charge Service for OpenStack",
            }
          }
        });

        // console.log(res.data);
      } else if (found.type !== config.type) {
        // update the config:
        const res = await this.ctx.curl(`${this.config.url}/services/${found.id}`, {
          dataType: 'json',
          method: 'PATCH',
          headers: {
            'X-Auth-Token': token.token,
            'Content-Type': 'application/json',
          },
          data: {
            "service": {
              "type": config.type,
            }
          }

        });
      }

      // Fetch endpoint:
      const endpointRes = await this.ctx.curl(`${this.config.url}/endpoints`, {
        dataType: 'json',
        headers: {
          'X-Auth-Token': token.token,
        }
      });

      const endpoints = endpointRes.data.endpoints;

      const endpointFound = {};
      const configEndpoint = config.endpoints;

      Object.keys(configEndpoint).forEach(region => {
        endpointFound[region] = null;
      });

      endpoints.forEach(endpoint => {
        const regionId = endpoint.region_id;
        if (endpoint.service_id === found.id && configEndpoint[regionId] && endpoint.interface === 'public') {
          if (endpoint.url === configEndpoint[regionId]) {
            endpointFound[regionId] = 'match';
          } else {
            endpointFound[regionId] = endpoint.id;
          }
        }
      });

      const promises = [];

      Object.keys(endpointFound).forEach(region => {
        const status = endpointFound[region];
        if (status === 'match') {
          // Do nothing.
        } else if (status === null) {
          const res = this.ctx.curl(`${this.config.url}/endpoints`, {
            dataType: 'json',
            method: 'PATCH',
            headers: {
              'X-Auth-Token': token.token,
              'Content-Type': 'application/json',
            },
            data: {
              "endpoint": {
                "url": configEndpoint[region],
                "interface": "public",
                "region_id": region,
                "service_id": found.id
              }
            }
          });
          promises.push(res);
        } else {
          // Update the endpoint:
          const res = this.ctx.curl(`${this.config.url}/endpoints/${status}`, {
            dataType: 'json',
            method: 'PATCH',
            headers: {
              'X-Auth-Token': token.token,
              'Content-Type': 'application/json',
            },
            data: {
              "endpoint": {
                "url": configEndpoint[region]
              }
            }
          });
          promises.push(res);
        }
      });

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      return services;
    }
  }
  return Server;
}