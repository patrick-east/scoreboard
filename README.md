Very simple 3rd party CI dashboard tool
=======================================
Requires:

* sqlite
* python-dev
* python-pip
* virtualenv


Setup the config files.. alter the path in config.py to match the location
of ci-scoreboard.conf. And update the ci-scoreboard.conf to have the right
values for your gerrit account and keyfile.

To run the server first init things with:

  `./env.sh`

Then source the virtual environment:

   `source ./.venv/bin/activate`
  
Setup the database with:

  `./scoreboard.py db init`
  `./scoreboard.py db upgrade`

And run the app with:

  `./scoreboard.py runserver`

