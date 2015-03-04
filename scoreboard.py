#!/usr/bin/env python

import datetime
import json
import logging
import re
import threading

from flask import Flask, request, render_template, send_from_directory
from flask.ext.sqlalchemy import SQLAlchemy
from flask.ext.script import Manager, Server
from flask.ext.migrate import Migrate, MigrateCommand
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import config
from infra import gerrit
import users

cfg = config.Config()

app = Flask(__name__)

# TODO: Maybe switch to mysql, postgres, or mariadb?
app.config['SQLALCHEMY_DATABASE_URI'] = cfg.db_uri()
app.debug = True

db = SQLAlchemy(app)
migrate = Migrate(app, db)

manager = Manager(app)
manager.add_command('db', MigrateCommand)
manager.add_command('runserver', Server(host='0.0.0.0'))

log_file = cfg.log_file() or 'scoreboard.log'
logging.basicConfig(filename=log_file, level=logging.INFO)

thirdparty_ci_usernames = []


class TestResult(db.Model):
    # TODO: Split out some of these strings like user names, project names, etc
    # so we aren't repeating them in every single row of the db
    id = db.Column(db.Integer, primary_key=True)
    review_id = db.Column(db.Integer)
    review_patchset = db.Column(db.Integer)
    result = db.Column(db.String(32))  # SUCCESS, FAIL, ERROR, NOT_REGISTERED
    user_name = db.Column(db.String(128))
    user_name_pretty = db.Column(db.String(128))
    project = db.Column(db.String(128))
    timestamp = db.Column(db.DateTime, index=True, default=datetime.datetime.utcnow)

    def simple(self):
        return {
            'review_id': self.review_id,
            'review_patchset': self.review_patchset,
            'result': self.result,
            'user_name': self.user_name,
            'user_name_pretty': self.user_name_pretty,
            'project': self.project,
            'timestamp': str(self.timestamp)
        }


@app.route('/')
def index():
    return render_template('index.html', host=request.host)


@app.route('/static/<path:path>')
def send_js(path):
    # TODO: We should probably use a real webserver for this..
    return send_from_directory('static', path)


@app.route('/query', methods=['GET'])
def handle_query():
    # TODO: We should have a cache for these
    # so we don't get hammered by reloading pages
    project = request.args.get('project', None)
    username = request.args.get('user', None)
    count = request.args.get('count', None)
    start = request.args.get('start', None)
    timeframe = request.args.get('timeframe', None)

    results = query_results(project, username, count, start, timeframe)
    simple_results = [r.simple() for r in results]
    return json.dumps(simple_results)


def query_results(project, user_name, count, start, timeframe):
    # TODO: Implement the "start" filter so we can do paginated responses
    # TODO: Implement allowing for a list of users so you can compare just a few
    # or if you have several ci accounts for your company or something.
    filter_args = {}

    if project:
        filter_args['project'] = project

    if user_name:
        filter_args['user_name'] = user_name

    query = TestResult.query.filter_by(**filter_args)

    if timeframe:
        num_hours = int(timeframe)
        current_time = datetime.datetime.utcnow()
        start_time = current_time - datetime.timedelta(hours=num_hours)
        query = query.filter(TestResult.timestamp > start_time)

    if count and count > 0:
        query = query.limit(count)

    result = query.order_by(TestResult.timestamp.desc()).all()
    return result


def get_thirdparty_users():
    # TODO: figure out how to do the authentication..
    # thirdparty_group = '95d633d37a5d6b06df758e57b1370705ec071a57'
    # url = 'http://review.openstack.org/groups/%s/members' % thirdparty_group
    # members = eval(urllib.urlopen(url).read())
    members = users.third_party_group
    for account in members:
        username = account[u'username']
        thirdparty_ci_usernames.append(username)


def is_ci_user(username):
    # TODO: query this from gerrit. Maybe save a copy in the db?
    return (username in thirdparty_ci_usernames) or (username == u'jenkins')


def determine_result(event):
    approvals = event.get(u'approvals', None)
    if approvals:
        for approval in approvals:
            vote = approval.get(u'value', 0)
            if int(vote) > 0:
                return 'SUCCESS'

    comment = event[u'comment']
    if re.search('FAILURE|FAILED', comment, re.IGNORECASE):
        return 'FAILURE'
    elif re.search('ERROR', comment, re.IGNORECASE):
        return 'ERROR'
    elif re.search('NOT_REGISTERED', comment, re.IGNORECASE):
        return 'NOT_REGISTERED'
    elif re.search('ABORTED', comment, re.IGNORECASE):
        return 'ABORTED'
    elif re.search('merge failed', comment, re.IGNORECASE):
        return 'MERGE FAILED'
    elif re.search('SUCCESS|SUCCEEDED', comment, re.IGNORECASE):
        return 'SUCCESS'
    else:
        return 'UNKNOWN'


def handle_gerrit_event(Session, event):
    # We only care about comments on reviews
    if event[u'type'] == u'comment-added' and is_ci_user(event[u'author'][u'username']):

        # special case for jenkins, it comments other things too, ignore those
        if event[u'author'][u'username'] == u'jenkins':
            if re.search('elastic|starting|merged', event[u'comment'], re.IGNORECASE):
                return

        session = Session()
        test_result = TestResult()
        test_result.user_name = event[u'author'][u'username']
        test_result.user_name_pretty = event[u'author'][u'name']
        test_result.review_id = event[u'change'][u'number']
        test_result.review_patchset = event[u'patchSet'][u'number']
        test_result.project = event[u'change'][u'project']
        test_result.result = determine_result(event)
        session.add(test_result)
        session.commit()


def gerrit_listener():
    # TODO: Maybe split this into its own process? Its kind of annoying that
    # when modifying the UI portion of the project it stops gathering data..
    hostname = cfg.gerrit_hostname()
    username = cfg.gerrit_user()
    port = cfg.gerrit_port()
    keyfile = cfg.gerrit_key()

    engine = create_engine(cfg.db_uri())
    Session = sessionmaker(bind=engine)

    g = gerrit.Gerrit(hostname, username, port=port, keyfile=keyfile)
    g.startWatching()

    get_thirdparty_users()

    while True:
        event = g.getEvent()
        handle_gerrit_event(Session, event)
        g.eventDone()

if __name__ == '__main__':
    t = threading.Thread(target=gerrit_listener)
    t.daemon = True
    t.start()
    manager.run()
    if t.isAlive():
        t.join(10)