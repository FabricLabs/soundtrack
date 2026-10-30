'use strict';

const neostandard = require('neostandard');

module.exports = [
  {
    ignores: [
      'tests/**',
      'node_modules/**',
      'assets/**',
      'reports/**',
      'stores/**'
    ]
  },
  ...neostandard({
    semi: true
  })
];
