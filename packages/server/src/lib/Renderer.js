import path from 'path';
import { match } from 'path-to-regexp';
import React from 'react';
import parseUrl from 'parseurl';
import ReactDOMServer from 'react-dom/server';
import { Helmet } from 'react-helmet';
import lodash from 'lodash';
import qs from 'qs';

const queryParse = qs.parse;

export default class Renderer {
  constructor(server) {
    this.server = server;
    this.options = server.options;

    this.cache = {};

    this.getContext = server.getContext.bind(server);

    this.getCurrentRouteAssets = this.getCurrentRouteAssets.bind(this);
    this.resolve = this.resolve.bind(this);
    this.requireReactComponent = this.requireReactComponent.bind(this);
    this.createReactElement = this.createReactElement.bind(this);
    this.renderReactToString = this.renderReactToString.bind(this);
    this.renderReactToStaticMarkup = this.renderReactToStaticMarkup.bind(this);
    this.render = this.render.bind(this);
  }

  /**
   * 获取资源
   * @param req
   * @returns {{entry: string, query: {}, params: {}, styles: string[], scripts: string[]}}
   */
  getCurrentRouteAssets(req) {
    const { options, server, cache } = this;
    const { dev } = options;
    const resources = server.resources || {};
    const { pathname, query } = parseUrl(req);

    if (!dev && cache[pathname]) return cache[pathname];

    const getAssets = (res) => {
      const resArr = res || [];
      return {
        styles: resArr.filter((row) => /\.css$/.test(row)),
        scripts: resArr.filter((row) => /\.js$/.test(row) && !/\.hot-update.js$/.test(row)),
      };
    };

    const defaultResult = {
      params: {},
      query,
      entry: '_error',
      ...getAssets(resources._error),
    };
    // 去除错误页面
    const resKeys = Object.keys(resources).filter((n) => n !== '_error');
    const keysLength = resKeys.length;
    if (!keysLength) {
      if (!dev) this.cache[pathname] = defaultResult;
      return defaultResult;
    }

    for (let i = 0; i < keysLength; i += 1) {
      const resName = resKeys[i];
      const matchPath = `/${resName.replace(new RegExp('/?index$'), '').replace(/_/g, ':')}`;
      const matchOptions = { decode: decodeURIComponent, strict: true, end: true, sensitive: false };
      // 正则匹配路径
      const result = match(matchPath, matchOptions)(pathname);
      if (result) {
        const resList = resources[resName];
        const params = {};
        Object.keys(result.params).forEach((name) => {
          params[name] = result.params[name];
        });
        const matchResult = {
          params,
          query: queryParse(query) || {},
          entry: resName,
          ...getAssets(resList),
        };
        if (!dev) this.cache[pathname] = matchResult;
        return matchResult;
      }
    }

    if (!dev) this.cache[pathname] = defaultResult;
    return defaultResult;
  }

  resolve(...p) {
    return path.join.apply(path, [this.options.dir.root].concat(p));
  }

  // 加载react组件
  requireReactComponent(_path) {
    const { options, resolve, cache } = this;
    const { dev, dir, build } = options;
    const fullPath = resolve(dir.build, build.dir.server, `${_path}.js`);

    let component = cache[fullPath] || require(fullPath);
    if (!component) {
      component = require(fullPath);
      if (!dev) this.cache[fullPath] = component;
    }

    const { default: Component, getServerSideProps } = component;
    if (dev) delete require.cache[fullPath];

    return { Component, getServerSideProps };
  }

  // 创建react元素
  createReactElement(component, opt) {
    return React.createElement(component, opt);
  }

  // 将react组件str
  renderReactToString(component, opt) {
    return ReactDOMServer.renderToString(this.createReactElement(component, opt));
  }

  // 将react组件渲染
  renderReactToStaticMarkup(component, opt) {
    return ReactDOMServer.renderToStaticMarkup(this.createReactElement(component, opt));
  }

  async render(req, res, next) {
    const {
      options,
      getCurrentRouteAssets,
      getContext,
      requireReactComponent,
      renderReactToString,
      renderReactToStaticMarkup,
    } = this;

    // Get assets
    const { entry, params, query, scripts: pageScripts, styles: pageStyles } = getCurrentRouteAssets(req);

    // Get context
    const context = getContext({ req: { ...req, params, query }, params, query, res });

    // Document
    const { Component: Document } = requireReactComponent('_document');
    // App
    const { Component: App, getServerSideProps: getAppServerSideProps } = requireReactComponent('_app');
    // Component
    const { Component, getServerSideProps } = requireReactComponent(entry);

    try {
      let state;
      let appState;
      let pageState;

      // App
      if (lodash.isFunction(getAppServerSideProps)) appState = await getAppServerSideProps(context);

      // page redirect
      let redirect;
      const redirectHandle = (status, redirectPath) => {
        let defStatus = status;
        let loc = redirectPath;
        if (typeof status === 'string') {
          defStatus = 302;
          loc = status;
        }
        // "back" is an alias for the referrer
        if (loc === 'back') loc = req.headers.Referrer || '/';

        redirect = {
          status: defStatus,
          path: loc,
        };
      };

      // page
      const pageCtx = lodash.defaultsDeep({}, context, { redirect: redirectHandle });
      if (lodash.isFunction(getServerSideProps)) pageState = await getServerSideProps(pageCtx);

      if (redirect) {
        res.setHeader('Location', redirect.path);
        res.statusCode = redirect.status;

        return res.end();
      }

      // deep state
      if (appState || pageState) state = lodash.defaultsDeep({}, appState || {}, pageState || {});

      // body
      const body = renderReactToString(App, {
        pageProps: state,
        Component,
      });

      // helmet
      const helmet = Helmet.renderStatic();

      // document(body, pageScripts, pageStyles, state, helmet, context, id)
      const content = renderReactToStaticMarkup(Document, {
        body,
        pageScripts,
        pageStyles,
        state,
        helmet,
        context: options.globals.context,
        id: options.globals.id,
      });

      const html = `<!doctype html>${content}`;
      // Send response
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Accept-Ranges', 'none');
      res.setHeader('Content-Length', Buffer.byteLength(html));

      res.end(html, 'utf8');
    } catch (err) {
      if (err.name === 'URIError') {
        err.statusCode = 400;
      }
      next(err);
    }
  }
}
