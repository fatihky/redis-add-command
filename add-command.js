require('shelljs/global');

var argv = require('minimist')(process.argv.slice(2));
var path = require('path');
var fs = require('fs');
var async = require('async');
var packageJson = require(path.join(__dirname, 'package.json'));

// command prototype regex
// example: {"customping",customPingCommand,4,"r",0,NULL,1,1,1,0,0}
var CMD_PROTO_REGEX = /^{"(\w+)",(\w+),(\d+),"(\w+)",0,NULL,1,1,1,0,0}$/;
var REDIS_ARCHIVE_URL = 'https://github.com/antirez/redis/archive/unstable.zip';

var buildDir = path.join(__dirname, 'build');
var redisPath = path.join(buildDir, 'redis');
var redisSrcPath = path.join(redisPath, 'src');
var redisArchivePath = path.join(buildDir, 'unstable.zip');
var redisUnzippedPath = path.join(buildDir, 'redis-unstable');

var commandDirs = [];
var filesToCopy = [];
var commandNames = [];
var commandDefinitions = [];
var objectFiles = []; // *.o
var indent = '    '; // redis' indentation, 4 bytes

// redis' own object files.
var redisServerObjectFiles = [];

async.series([
  function prepareAsync(done) {
    // set object files etc
    prepare();

    done();
  }, function createAndEnterToBuildDir(done) {
    // create and enter the build dir
    cd(__dirname);

    if (!fs.existsSync(buildDir))
      mkdir('-p', 'build');

    cd('build');

    done();
  }, function cloneRedis(done) {
    // clone redis
    if (fs.existsSync(redisSrcPath))
      return done();

    exec('git clone https://github.com/antirez/redis', {silent: true}, done);
  }, function downloadRedisArchive(done) {
    var curr = process.cwd();

    if (fs.existsSync(redisArchivePath))
      return done();

    cd(buildDir);
    exec('wget ' + REDIS_ARCHIVE_URL, {silen: true}, function (code) {
      if (code !== 0)
        return done(code);

      cd(curr);
      done();
    })
  }, function unzipRedis(done) {
    var curr = process.cwd();

    if (fs.existsSync(redisUnzippedPath))
      return done();

    cd(buildDir);
    exec('unzip -q ' + redisArchivePath, {silent: true}, function (code) {
      if (code !== 0)
        return done(code);

      cd(curr);

      done();
    });
  }, function setServerObjectFiles(done) {
    var makefile = path.join(redisUnzippedPath, 'src', 'Makefile');
    var contents = fs.readFileSync(makefile).toString();
    redisServerObjectFiles = /REDIS_SERVER_OBJ=(.*)/
                             .exec(contents)[1]
                             .split(' ');
    redisServerObjectFiles.push('redis-benchmark.o', 'redis-check-aof.o',
                                'redis-cli.o');
    done();
  }, function resetRedisSrcPath(done) {
    var curr = process.cwd();
    cd(buildDir);
    async.series([
      function (done) {
        var objects = ls('redis/src/*.o');
        var sources = ls('redis/src/*.c');

        // do not remove redis' core object files(anet.o adlist.o etc...)
        // so we will not have to compile them again
        redisServerObjectFiles.forEach(function(file, i) {
          var sourceFile = 'redis/src/' +
                           file.substr(0, file.indexOf('.o')) + '.c';
          var index = objects.indexOf('redis/src/' + file);
          var sourcesIndex = sources.indexOf(sourceFile);

          if (sourcesIndex >= 0)
            sources.splice(sourcesIndex, 1);

          if (index < 0)
            return console.log(file, 'not found');

          objects.splice(index, 1);
        });

        [
          'redis/src/ae_epoll.c',
          'redis/src/ae_evport.c',
          'redis/src/ae_kqueue.c',
          'redis/src/ae_select.c',
        ].forEach(function(file, i) {
          var index = sources.indexOf(file);
          sources.splice(index, 1);
        });

        console.log('rm -rf ' + sources.join(' ') + ' ' + objects.join(' '));
        exec('rm -rf ' + sources.join(' ') + ' ' + objects.join(' '), {silent: true}, done);
      },
      function (done) {
        // exec('cp redis-unstable/src/*.c redis/src', {silent: true}, done);
        done();
      }
    ], function(err) {
      cd(curr);
      done(err);
    });
  }, function prepareBeforeBuild (done) {
    copyFiles();
    insertCommandPrototypes();
    insertCommands();
    insertObjectPaths();

    // build redis
    cd(buildDir);
    cd("redis");

    done();
  }, function buildRedis(done) {
    exec('make', {silent: false}, done);
  }], function (err) {
    if (err)
      throw new Error(err);

    console.log('Completed. You can use your custom redis build now!');
  });

function usage() {
  console.log('redis-add-command.js v' + packageJson.version);
  console.log('Usage:');
  console.log('node redis-add-command.js [dirname ...]');
}

function prepare(argument) {
  argv._.forEach(function (dirname) {
    var resolved = path.resolve(dirname);

    var files = ls(resolved + '/sources/*');
  
    var config = require(path.join(resolved, 'config.json'));
    var commands = config.commands;
  
    files.forEach(function (file) {
      var basename = path.basename(file);
      var ext = path.extname(basename);
      if (ext === '.c')
        objectFiles.push(basename.replace('.c', '.o'));
  
      filesToCopy.push(file);
    });
  
    commands.forEach(function (command) {
      var arr = CMD_PROTO_REGEX.exec(command)
  
      // not valid command definition. continue
      if (arr ===  null)
        return;
  
      // second argument is function name
      // we will use it to adding command definition to server.h
      var commandName = arr[2];
  
      commandNames.push(commandName);
  
      // we are storing full command definitions for adding them to server.c
      commandDefinitions.push(command);
    });
  
    commandDirs.push(resolved);
  });
}

function copyFiles() {
  filesToCopy.forEach(function(file, i) {
    var filename = path.basename(file);
    cp (file, path.join(redisSrcPath, filename));
  });
}

function fileReplace(filePath, find, replace) {
  var contents = fs.readFileSync(filePath).toString();

  contents = contents.replace(find, replace);

  fs.writeFileSync(filePath, contents);
}

function insertCommandPrototypes() {
  var str = '/* custom commands start */';
  var comment = '/* Commands prototypes */';
  var serverHeader = path.join(redisSrcPath, 'server.h');

  commandNames.forEach(function(commandName) {
    var proto = ['void', commandName, '(client *c);\n'].join(' ');
    str += proto;
  });

  str += '/* custom commands start */';

  fileReplace(serverHeader, comment, comment + '\n' + str);
}

function insertCommands() {
  var start = 'struct redisCommand redisCommandTable[] = {';
  var serverSource = path.join(redisSrcPath, 'server.c');
  var str = '/* custom commands start */\n' + indent;

  str += commandDefinitions.join(',\n' + indent) + ',\n' + indent;
  str += '/* custom commands end */';

  fileReplace(serverSource, start, start + '\n' + indent + str);
}

function insertObjectPaths() {
  var start = 'REDIS_SERVER_OBJ=';
  var makefile = path.join(redisSrcPath, 'Makefile');

  fileReplace(makefile, start, start + objectFiles.join(' ') + ' ');
}