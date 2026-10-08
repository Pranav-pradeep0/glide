module.exports = {
    project: {
        android: {},
    },
    // No `assets` entry: the fonts are committed directly to
    // android/app/src/main/assets/fonts, so there is nothing for react-native-asset to
    // link. The path this used to name has never existed in this repo.
};
