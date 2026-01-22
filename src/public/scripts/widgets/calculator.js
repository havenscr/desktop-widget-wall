/* ================================================================
   CALCULATOR MODULE
   Simple calculator with keyboard support
   ================================================================ */

const calculator = {
  displayValue: '0',
  firstOperand: null,
  waitingForSecondOperand: false,
  operator: null,
  expression: ''
};

function updateCalcDisplay() {
  const resultEl = document.getElementById('calc-result');
  const exprEl = document.getElementById('calc-expression');
  if (resultEl) resultEl.textContent = calculator.displayValue;
  if (exprEl) exprEl.textContent = calculator.expression;
}

function inputDigit(digit) {
  if (calculator.waitingForSecondOperand) {
    calculator.displayValue = digit;
    calculator.waitingForSecondOperand = false;
  } else {
    calculator.displayValue = calculator.displayValue === '0' ? digit : calculator.displayValue + digit;
  }
}

function inputDecimal() {
  if (calculator.waitingForSecondOperand) {
    calculator.displayValue = '0.';
    calculator.waitingForSecondOperand = false;
    return;
  }
  if (!calculator.displayValue.includes('.')) {
    calculator.displayValue += '.';
  }
}

function getOperatorSymbol(op) {
  const symbols = { add: '+', subtract: '-', multiply: 'x', divide: '/' };
  return symbols[op] || op;
}

function calculate(first, second, operator) {
  switch (operator) {
    case 'add': return first + second;
    case 'subtract': return first - second;
    case 'multiply': return first * second;
    case 'divide': return second !== 0 ? first / second : 'Error';
    default: return second;
  }
}

function handleOperator(nextOperator) {
  const inputValue = parseFloat(calculator.displayValue);

  if (calculator.operator && calculator.waitingForSecondOperand) {
    calculator.operator = nextOperator;
    calculator.expression = calculator.firstOperand + ' ' + getOperatorSymbol(nextOperator);
    return;
  }

  if (calculator.firstOperand === null && !isNaN(inputValue)) {
    calculator.firstOperand = inputValue;
  } else if (calculator.operator) {
    const result = calculate(calculator.firstOperand, inputValue, calculator.operator);
    calculator.displayValue = String(result);
    calculator.firstOperand = result;
  }

  calculator.waitingForSecondOperand = true;
  calculator.operator = nextOperator;
  calculator.expression = calculator.firstOperand + ' ' + getOperatorSymbol(nextOperator);
}

function resetCalculator() {
  calculator.displayValue = '0';
  calculator.firstOperand = null;
  calculator.waitingForSecondOperand = false;
  calculator.operator = null;
  calculator.expression = '';
}

function handleEquals() {
  if (!calculator.operator || calculator.waitingForSecondOperand) return;

  const inputValue = parseFloat(calculator.displayValue);
  const result = calculate(calculator.firstOperand, inputValue, calculator.operator);

  calculator.expression = calculator.firstOperand + ' ' + getOperatorSymbol(calculator.operator) + ' ' + inputValue + ' =';
  calculator.displayValue = String(result);
  calculator.firstOperand = result;
  calculator.operator = null;
  calculator.waitingForSecondOperand = false;
}

function handlePercent() {
  const value = parseFloat(calculator.displayValue);
  calculator.displayValue = String(value / 100);
}

function handleNegate() {
  const value = parseFloat(calculator.displayValue);
  calculator.displayValue = String(value * -1);
}

function handleBackspace() {
  if (calculator.displayValue.length === 1 ||
      (calculator.displayValue.length === 2 && calculator.displayValue.startsWith('-'))) {
    calculator.displayValue = '0';
  } else {
    calculator.displayValue = calculator.displayValue.slice(0, -1);
  }
}

function initCalculator() {
  // Button click handlers
  document.querySelectorAll('.calc-btn').forEach(button => {
    button.addEventListener('click', () => {
      const value = button.dataset.value;
      const action = button.dataset.action;

      if (value !== undefined) {
        if (value === '.') {
          inputDecimal();
        } else {
          inputDigit(value);
        }
      } else if (action) {
        switch (action) {
          case 'clear': resetCalculator(); break;
          case 'backspace': handleBackspace(); break;
          case 'percent': handlePercent(); break;
          case 'negate': handleNegate(); break;
          case 'decimal': inputDecimal(); break;
          case 'equals': handleEquals(); break;
          default: handleOperator(action);
        }
      }
      updateCalcDisplay();
    });
  });

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key;
    let handled = false;

    if (/^[0-9]$/.test(key)) {
      inputDigit(key);
      handled = true;
    } else if (key === '.' || key === ',') {
      inputDecimal();
      handled = true;
    } else if (key === '+') {
      handleOperator('add');
      handled = true;
    } else if (key === '-') {
      handleOperator('subtract');
      handled = true;
    } else if (key === '*' || key === 'x' || key === 'X') {
      handleOperator('multiply');
      handled = true;
    } else if (key === '/') {
      handleOperator('divide');
      handled = true;
    } else if (key === '=' || key === 'Enter') {
      handleEquals();
      handled = true;
    } else if (key === 'Escape' || key === 'c' || key === 'C') {
      resetCalculator();
      handled = true;
    } else if (key === 'Backspace') {
      handleBackspace();
      handled = true;
    } else if (key === '%') {
      handlePercent();
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      updateCalcDisplay();
    }
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCalculator);
} else {
  initCalculator();
}
