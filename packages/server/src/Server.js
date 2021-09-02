import path from 'path';
import fs from 'fs';
import lodash from 'lodash';
import connect from 'connect';
import compression from 'compression';
import serveStatic from 'serve-static';
import consola from 'consola';
import Renderer from './lib/Renderer';

export default class Server {
  constructor(options) {
    this.options = options;
    this.app = connect();

    this.devMiddleware = null;

    this.resources = {};

    this.context = {};

    this.routeStacks = [];

    this.renderer = new Renderer(this);

    this.ready = this.ready.bind(this);
    this.setupMiddleware = this.setupMiddleware.bind(this);
    this.useMiddleware = this.useMiddleware.bind(this);
    this.setDevMiddleware = this.setDevMiddleware.bind(this);
    this.loadResources = this.loadResources.bind(this);
    this.getContext = this.getContext.bind(this);
    this.setupContext = this.setupContext.bind(this);
    this.listen = this.listen.bind(this);
  }

  /**
   * 设置dev中间件
   * @param middleware
   */
  setDevMiddleware(middleware) {
    if (middleware) this.devMiddleware = middleware;
  }

  /**
   * load client resources
   * @param _fs fs|mfs
   * @returns Promise({{}})
   */
  loadResources(_fs) {
    const { options } = this;
    const { dir, build } = options;

    let result = {};

    try {
      const fullPath = path.join(dir.root, dir.build, build.dir.manifest);

      if (_fs.existsSync(fullPath)) {
        const contents = _fs.readFileSync(fullPath, 'utf-8');

        result = JSON.parse(contents) || {};
      }
    } catch (err) {
      result = {};
    }

    this.resources = result;

    return Promise.resolve(result);
  }

  getContext(ctx) {
    const { context } = this;

    return lodash.defaultsDeep({}, context, ctx);
  }

  async ready() {
    const { _readyCalled, setupContext, setupMiddleware, options, loadResources } = this;
    if (_readyCalled) return this;
    this._readyCalled = true;

    // Setup cluth server context
    await setupContext();

    // Setup cluth middleware
    await setupMiddleware();

    if (!options.dev) await loadResources(fs);

    return this;
  }

  async setupContext() {
    const { options } = this;
    const { server } = options;
    const contextHandle = server.context;
    let ctx = {};
    if (typeof contextHandle === 'function') ctx = await contextHandle(options);

    this.context = ctx;
  }

  setupMiddleware() {
    const { options, useMiddleware, renderer } = this;
    const { dev, server, build, dir } = options;
    const { compressor, middleware } = server || {};

    if (dev) {
      useMiddleware((req, res, next) => {
        const { devMiddleware } = this;
        if (devMiddleware) return devMiddleware(req, res, next);

        return next();
      });
    } else {
      // gzip
      if (typeof compressor === 'object') {
        // If only setting for `compression` are provided, require the module and insert
        useMiddleware(compression(compressor));
      } else if (compressor) {
        // Else, require own compression middleware if compressor is actually truthy
        useMiddleware(compressor);
      }

      if (!build.publicPath.startsWith('http')) {
        // static
        const staticMiddleware = serveStatic(path.join(dir.root, dir.build, build.dir.static));
        useMiddleware({
          route: `/${build.dir.static}`,
          handle: staticMiddleware,
        });
      }
    }

    // Add user provided middleware
    (middleware || []).forEach(useMiddleware);

    // Finally use routerMiddleware
    useMiddleware(renderer.render);
  }

  useMiddleware(middleware) {
    const { app } = this;

    if (typeof middleware === 'object') return app.use(middleware.route || '/', middleware.handle);

    return app.use(middleware);
  }

  listen() {
    const { options, app } = this;
    const { host, port } = options.server;

    app.listen(port, host);

    consola.ready({
      message: `Server listening on http://${host}:${port}`,
      badge: true,
    });
  }
}
