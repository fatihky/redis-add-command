require('shelljs/global');

var argv = require('minimist')(process.argv.slice(2));
var path = require('path');
var fs = require('fs');
var packageJson = require(path.join(__dirname, 'package.json'));

// command prototype regex
// example: {"customping",customPingCommand,4,"r",0,NULL,1,1,1,0,0}
var CMD_PROTO_REGEX = /^{"(\w+)",(\w+),(\d+),"(\w+)",0,NULL,1,1,1,0,0}$/;

var buildDir = path.join(__dirname, 'build');
var redisPath = path.join(buildDir, 'redis');
var redisSrcPath = path.join(redisPath, 'src');

var commandDirs = [];
var filesToCopy = [];
var commandNames = [];
var commandDefinitions = [];
var objectFiles = []; // *.o
var indent = '    '; // redis' indentation, 4 bytes
var force = false;

console.dir(argv);

// check force option. if this option not passed, build dir will not be deleted
// automatically

if (typeof argv.force === 'string') {
  argv._.push(argv.force);
  argv.force = true;
  force = true;
}

if (typeof argv.f === 'string') {
  argv._.push(argv.f);
  argv.f = true;
  force = true;
}

if (argv._.length === 0) {
  usage();
  process.exit(0);
}

force = force || argv.force === true || argv.f === true;

if (fs.existsSync(buildDir) && !force) {
  console.log('build directory already exist. Use --force or -f to continue.');
  process.exit(1);
}

// set object files etc
prepare();

// create and enter the build dir
cd(__dirname);
rm('-rf', 'build');
mkdir('-p', 'build');
cd('build');

// clone redis
exec('git clone https://github.com/antirez/redis', function () {
  copyFiles();
  insertCommandPrototypes();
  insertCommands();
  insertObjectPaths();

  // build redis
  cd(buildDir);
  cd("redis");

  exec('make', function() {
    console.log('\n\nComplete. You can use your custom redis build now!');
  });
});

function usage() {
  console.log('redis-add-command.js v' + packageJson.version);
  console.log('Usage:');
  console.log('node redis-add-command.js [--force|-f] [dirname ...]');
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