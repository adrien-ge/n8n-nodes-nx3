export default {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          removeHiddenElems: { opacity0: true },
        },
      },
    },
    'removeDimensions',
  ],
};
