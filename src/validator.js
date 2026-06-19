function toNumber(str, mapping, base) {
  if (str.length === 0) return { value: 0, valid: true };
  if (mapping[str[0]] === 0 && str.length > 1) {
    return { value: NaN, valid: false, reason: `"${str}" 的首位不能为 0` };
  }
  let val = 0;
  for (const ch of str) {
    if (mapping[ch] === undefined) {
      return { value: NaN, valid: false, reason: `字母 "${ch}" 未赋值` };
    }
    if (mapping[ch] < 0 || mapping[ch] >= base) {
      return { value: NaN, valid: false, reason: `${ch}=${mapping[ch]} 超出 ${base} 进制范围 [0, ${base - 1}]` };
    }
    val = val * base + mapping[ch];
  }
  return { value: val, valid: true };
}

function tokenizeExpression(expr) {
  const tokens = [];
  let currentTerm = '';
  for (const ch of expr.toUpperCase()) {
    if (/[A-Z0-9]/.test(ch)) {
      currentTerm += ch;
    } else if ('+-*='.includes(ch)) {
      if (currentTerm) {
        tokens.push({ type: 'term', value: currentTerm });
        currentTerm = '';
      }
      tokens.push({ type: 'op', value: ch });
    }
  }
  if (currentTerm) {
    tokens.push({ type: 'term', value: currentTerm });
  }
  return tokens;
}

function termToNumber(term, mapping, base) {
  if (/^\d+$/.test(term)) {
    for (const ch of term) {
      const digit = parseInt(ch);
      if (digit >= base) {
        return { value: NaN, valid: false, reason: `数字 "${digit}" 超出 ${base} 进制范围` };
      }
    }
    return { value: parseInt(term, base), valid: true };
  }
  return toNumber(term, mapping, base);
}

function validateMappingUnique(mapping) {
  const used = new Set();
  for (const key in mapping) {
    const val = mapping[key];
    if (typeof val !== 'number' || isNaN(val)) {
      return { valid: false, reason: `"${key}" 的值无效` };
    }
    if (used.has(val)) {
      return { valid: false, reason: `数字 ${val} 被重复使用` };
    }
    used.add(val);
  }
  return { valid: true };
}

function validateSolution(base, expression, mapping) {
  const upperMapping = {};
  for (const key in mapping) {
    upperMapping[key.toUpperCase()] = mapping[key];
  }

  const uniqueCheck = validateMappingUnique(upperMapping);
  if (!uniqueCheck.valid) {
    return { valid: false, reason: uniqueCheck.reason };
  }

  const tokens = tokenizeExpression(expression);

  let leftTokens = [];
  let rightTokens = [];
  let foundEqual = false;
  for (const tok of tokens) {
    if (tok.type === 'op' && tok.value === '=') {
      foundEqual = true;
      continue;
    }
    if (foundEqual) {
      rightTokens.push(tok);
    } else {
      leftTokens.push(tok);
    }
  }

  if (!foundEqual) {
    return { valid: false, reason: '算式中缺少等号' };
  }

  function evaluate(tokList) {
    if (tokList.length === 0) return { value: NaN, valid: false, reason: '表达式为空' };

    const nums = [];
    const ops = [];

    for (const tok of tokList) {
      if (tok.type === 'term') {
        const r = termToNumber(tok.value, upperMapping, base);
        if (!r.valid) return r;
        nums.push(r.value);
      } else {
        ops.push(tok.value);
      }
    }

    if (nums.length !== ops.length + 1) {
      return { value: NaN, valid: false, reason: '表达式格式不正确' };
    }

    let result = nums[0];
    for (let i = 0; i < ops.length; i++) {
      switch (ops[i]) {
        case '+':
          result += nums[i + 1];
          break;
        case '-':
          result -= nums[i + 1];
          break;
        case '*':
          result *= nums[i + 1];
          break;
        default:
          return { value: NaN, valid: false, reason: `不支持的运算符 "${ops[i]}"` };
      }
    }
    return { value: result, valid: true };
  }

  const leftResult = evaluate(leftTokens);
  if (!leftResult.valid) return leftResult;

  const rightResult = evaluate(rightTokens);
  if (!rightResult.valid) return rightResult;

  if (leftResult.value !== rightResult.value) {
    return {
      valid: false,
      reason: `等式不成立：左边=${leftResult.value}，右边=${rightResult.value}`
    };
  }

  return { valid: true };
}

module.exports = { validateSolution, tokenizeExpression, toNumber };
