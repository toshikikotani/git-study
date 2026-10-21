// iPhone 版は、Web 版と同じ計算・約束(リポジトリの src/)を読む(ADR-132)。Metro に src/ も見せる。
// src/ のファイルは外の npm パッケージを読まない(読むのは src/ の中だけ)ので、node_modules は mobile/ のものだけ。
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../src')];

module.exports = config;
