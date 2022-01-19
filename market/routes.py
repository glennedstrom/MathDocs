from os import error
from typing import List
from market import app
from flask import render_template, redirect, url_for, flash, get_flashed_messages, Response, request, Flask, send_from_directory
from market.models import User#, Item#, Currency
from market.forms import RegisterForm, LoginForm
from market import db
#from matplotlib import pyplot as plt
import sys

#from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas

from sympy.parsing.latex import parse_latex
import sympy
from market import sympytypehandler


#send_from_directory checks the file path so they can't put ../../ into the path to snoop in your files
@app.route("/static/<path:path>")
def static_dir(path):
    print("sending shit", app.root_path, file=sys.stderr)
    return send_from_directory("static", path)

original = None

#background process happening without any refreshing
@app.route('/sympy/')
def checkAnswer():
    global original
    correct = False
    latex=request.args.get('l')
    f=request.args.get('f')!=None

    #remove invalid characters
    latex = latex.replace(r"\ ", "") #user space
    latex = latex.replace(r"\int_{ }^{ }", r"\int ") # blank integral
    latex = latex.replace(r"\int_{}^{}", r"\int ") # integral with space added to remove boxes


    try:
        equation = parse_latex(latex)#.simplify()#.doit()
    except Exception as e:
        return "parsing error", e

    #solve and simplify
    equation = sympytypehandler.solve(equation)
    print(equation)

    #if type(equation) != sympy.Eq:
    #    equation = sympy.Eq(equation, 0)


    if f: #update main equation stuff
        original = equation
    elif not original:
        print("original variable does not exist: make sure you check all of the answers when you load them in on javascript to suppress this error. batch requests to make it take less requests too")
        print("press enter in the top box to solve the original equation")


    if type(equation) == list:
        print(equation)
        a = True
        for i in equation:
            a*= i in original
        correct = bool(a)
    else:
        if sympy.simplify(original - equation):
            print("solved", file=sys.stderr)
            if not equation.equals(original):
                print("your solution sucks, sympy solved it better", file=sys.stderr)
            correct = True
        else:
            print(equation, "is incorrect", file=sys.stderr)
    return ','.join([str(i) for i in [correct, equation]])

@app.route('/')
@app.route('/home/')
def home_page():
    return render_template('home.html')

#saved_eq = ["y=mx+b", "a^2+b^2=c^2", '"e=mc^2"']

@app.route('/math/')#, methods=["GET","POST"])
def math_page(index=None, enteredMath=None):
    """global saved_eq
    if enteredMath:
        saved_eq[index] = enteredMath
    saved_eq = ["\"" + i + "\"" if i[0] != "\"" and i[-1] != "\"" else i for i in saved_eq]""" # watch out for string quote injections from the math input. that could mess you up, experiment with it when you make it save the equations
    return render_template('math.html')


@app.route('/register/', methods=['GET', 'POST'])
def register_page():
    form = RegisterForm()
    if form.validate_on_submit():
        user_to_create = User(username=form.username.data,
                              email_address=form.email_address.data,
                              password=form.password1.data)
        db.session.add(user_to_create)
        db.session.commit()
        return redirect(url_for('market_page'))  # change this probably
    if form.errors != {}:  # if exists
        for err in form.errors.values():
            flash(f"Error creating user: {err}", category='danger')
    return render_template('register.html', form=form)


@app.route('/login/', methods=['GET', 'POST'])
def login_page():
    form = LoginForm()
    return render_template('login.html', form=form)
