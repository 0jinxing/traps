const path = require('path')
const HtmlPlugin = require('html-webpack-plugin')

module.exports = {
  mode: 'development',

  entry: path.resolve('src', 'index.ts'),

  output: {
    publicPath: '/',
    path: path.resolve('dist'),
    filename: '[name].[hash:8].js'
  },

  module: {
    rules: [
      {
        test: /.tsx?$/i,
        use: ['babel-loader', 'ts-loader']
      },
      {
        test: /.s?css?$/i,
        use: ['style-loader', 'css-loader', 'sass-loader']
      },
      {
        test: /\.(png|jpg|gif|svg)$/i,
        use: [{ loader: 'url-loader', options: { limit: 8192 } }]
      }
    ]
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: {
      '@': path.resolve('src')
    }
  },

  plugins: [
    new HtmlPlugin({
      template: path.resolve('public/index.html'),
      filename: 'index.html',
      hash: true
    })
  ],

  devServer: {
    contentBase: path.resolve('dist'),
    compress: true,
    hot: true,
    historyApiFallback: true,
    port: 8080,
    open: true
  }
}
