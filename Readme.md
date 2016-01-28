Simple node.js script that helps to build redis with custom commands.

Using:
  1. Create directory named `my custom command`.
  2. Enter your newly created directory and create `sources` directory.
  3. Place your c sources in here.
  4. And create `config.json` file which contains your configuration.
  5. Clone this repository.
  6. Enter the this repository's directory.
  7. Install dependencies with `npm install`.
  8. Run this command: `node add-command.js "../my custom command"`

Completed! Your custom redis build is ready to use! Your newly built redis is
placed at`build/redis`.

Your custom commands should be in this type: `void myPingCommand(client *c)`.

Example `config.json`:

```json
{
  "commands": [
    "{\"myping\",myPingCommand,1,\"r\",0,NULL,1,1,1,0,0}"
  ]
}
```
