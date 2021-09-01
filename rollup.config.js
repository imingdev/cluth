import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [{
  input: './packages/builder/src/Builder.js',
  output: {
    file: './packages/builder/dist/Builder.js',
    format: 'cjs',
    exports: 'auto',
  },
  plugins: [
    // 支持第三方模块
    resolve(),
    // 支持 commonjs 格式
    commonjs(),
  ],
  // 第三方模块不会强行打包到输出中
  external: Object.keys(require('./packages/builder/package.json').dependencies),
}, {
  input: './packages/server/src/Server.js',
  output: {
    file: './packages/server/dist/Server.js',
    format: 'cjs',
    exports: 'auto',
  },
  plugins: [
    // 支持第三方模块
    resolve(),
    // 支持 commonjs 格式
    commonjs(),
  ],
  // 第三方模块不会强行打包到输出中
  external: Object.keys(require('./packages/server/package.json').dependencies).concat(['react', 'react-dom', 'react-dom/server']),
}];
