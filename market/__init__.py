import bcrypt
from flask import Flask, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
import os

app = Flask(__name__, static_url_path='')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///market.db'
if os.path.exists('key.env'):
    with open("key.env", 'r') as f:
        app.config['SECRET_KEY'] = f.readline()
else:
    app.config['SECRET_KEY'] = '1roasnetoih2douwdnoiw23changeme'
app.config['PACKAGES'] = "/node_modules"
app.config['UPLOAD_FOLDER'] = "market/static/uploads"

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
from market import routes
