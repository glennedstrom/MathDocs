import sympy
import csv

from sympy.parsing.latex import parse_latex


def equivalent(eq1, eq2):
    if type(eq1) == sympy.Eq:
        print(eq1)
        eq1 = eq1[0] - eq1[1]
        print(eq1)
        sympy.doit(eq1)

    if type(eq2) == sympy.Eq:
        sympy.doit(eq1)

    if eq1.equals(eq2) and sympy.simplify(eq1 - eq2):
        return True

def solve(input):
    
    if type(input) in [sympy.Integral, sympy.Derivative]:
        input = input.doit()

    if type(input) in [sympy.Add, sympy.Mul, sympy.Eq]:
        input = sympy.solve(input)
    return input    


def main(equations): #just for testing

    x = sympy.Symbol('x')
    for eq in equations:
        solve(eq)

def csv_append(latex):
    with open('market/example_equations.csv', 'a') as f:
        f.write(latex+'\n')


if __name__ == "__main__":
    equations = None 
    with open('market/example_equations.csv', 'r') as f:
        equations = [parse_latex(i[0]) for i in csv.reader(f)]
    main(equations)
    #random = sympy.random_poly(x, 2, 0, 8)
    #csv_append(sympy.latex(random))
    #main(random)




