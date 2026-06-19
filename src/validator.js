function toNumber(str, mapping, base) {
  if (str.length === 0) return { value: 0, valid: true };
  if (mapping[str[0]] === 0 && str.length > 1) {
    return { value: NaN, valid: false, reason: `"${str}" 的首位不能为 0`, errorLetters: [str[0]], errorType: 'leading_zero' };
  }
  let val = 0;
  for (const ch of str) {
    if (mapping[ch] === undefined) {
      return { value: NaN, valid: false, reason: `字母 "${ch}" 未赋值`, errorLetters: [ch], errorType: 'unassigned' };
    }
    if (mapping[ch] < 0 || mapping[ch] >= base) {
      return { value: NaN, valid: false, reason: `${ch}=${mapping[ch]} 超出 ${base} 进制范围 [0, ${base - 1}]`, errorLetters: [ch], errorType: 'out_of_range' };
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
        return { value: NaN, valid: false, reason: `数字 "${digit}" 超出 ${base} 进制范围`, errorLetters: [], errorType: 'digit_out_of_range' };
      }
    }
    return { value: parseInt(term, base), valid: true };
  }
  return toNumber(term, mapping, base);
}

function getDigitAt(num, pos, base) {
  if (num < 0) num = -num;
  return Math.floor(num / Math.pow(base, pos)) % base;
}

function getTermDigit(term, pos, mapping, base) {
  if (/^\d+$/.test(term)) {
    const n = parseInt(term, base);
    return getDigitAt(n, pos, base);
  }
  const reversed = term.split('').reverse();
  if (pos >= reversed.length) return 0;
  const ch = reversed[pos];
  if (mapping[ch] === undefined) return null;
  return mapping[ch];
}

function getTermLetterAt(term, pos) {
  if (/^\d+$/.test(term)) return null;
  const reversed = term.split('').reverse();
  if (pos >= reversed.length) return null;
  return reversed[pos];
}

function validateMappingUnique(mapping) {
  const used = new Map();
  for (const key in mapping) {
    const val = mapping[key];
    if (typeof val !== 'number' || isNaN(val)) {
      return { valid: false, reason: `"${key}" 的值无效`, errorLetters: [key], errorType: 'invalid_value' };
    }
    if (used.has(val)) {
      return {
        valid: false,
        reason: `数字 ${val} 被重复使用（字母 "${used.get(val)}" 和 "${key}"）`,
        errorLetters: [used.get(val), key],
        errorType: 'duplicate'
      };
    }
    used.set(val, key);
  }
  return { valid: true };
}

function evaluateSimple(tokList, mapping, base) {
  const nums = [];
  const ops = [];
  for (const tok of tokList) {
    if (tok.type === 'term') {
      const r = termToNumber(tok.value, mapping, base);
      if (!r.valid) return r;
      nums.push({ value: r.value, term: tok.value });
    } else {
      ops.push(tok.value);
    }
  }
  if (nums.length !== ops.length + 1) {
    return { value: NaN, valid: false, reason: '表达式格式不正确', errorLetters: [], errorType: 'syntax' };
  }
  let result = nums[0].value;
  for (let i = 0; i < ops.length; i++) {
    switch (ops[i]) {
      case '+': result += nums[i + 1].value; break;
      case '-': result -= nums[i + 1].value; break;
      case '*': result *= nums[i + 1].value; break;
      default:
        return { value: NaN, valid: false, reason: `不支持的运算符 "${ops[i]}"`, errorLetters: [], errorType: 'operator' };
    }
  }
  return { value: result, valid: true };
}

function analyzeColumnByColumn(base, tokensLeft, tokensRight, mapping) {
  const leftTerms = tokensLeft.filter(t => t.type === 'term').map(t => t.value);
  const leftOps = tokensLeft.filter(t => t.type === 'op').map(t => t.value);
  const rightTerms = tokensRight.filter(t => t.type === 'term').map(t => t.value);

  const allTerms = [...leftTerms, ...rightTerms];
  const maxLen = Math.max(...allTerms.map(t => t.length));

  if (leftOps.length === 1 && leftOps[0] === '+') {
    return analyzeAddition(base, leftTerms, rightTerms[0], mapping, maxLen);
  }
  if (leftOps.length === 1 && leftOps[0] === '-') {
    return analyzeSubtraction(base, leftTerms, rightTerms[0], mapping, maxLen);
  }
  if (leftOps.length === 1 && leftOps[0] === '*') {
    return analyzeMultiplication(base, leftTerms, rightTerms[0], mapping, maxLen);
  }
  if (leftOps.every(op => op === '+')) {
    return analyzeAddition(base, leftTerms, rightTerms[0], mapping, maxLen);
  }

  return genericAnalyze(base, tokensLeft, tokensRight, mapping, allTerms);
}

function analyzeAddition(base, addends, sumTerm, mapping, maxLen) {
  let carry = 0;
  const columnDetails = [];

  for (let pos = 0; pos < maxLen + 2; pos++) {
    let colSum = carry;
    const lettersInCol = [];
    const digitValues = [];

    for (const term of addends) {
      const letter = getTermLetterAt(term, pos);
      const digit = getTermDigit(term, pos, mapping, base);
      if (letter !== null) {
        lettersInCol.push(letter);
        digitValues.push(`${letter}=${digit !== null ? digit : '?'}`);
      }
      if (digit !== null) colSum += digit;
    }

    const expectedDigit = colSum % base;
    const nextCarry = Math.floor(colSum / base);

    const sumLetter = getTermLetterAt(sumTerm, pos);
    const sumDigit = getTermDigit(sumTerm, pos, mapping, base);
    if (sumLetter !== null) {
      lettersInCol.push(sumLetter);
      digitValues.push(`${sumLetter}=${sumDigit !== null ? sumDigit : '?'}`);
    }

    columnDetails.push({
      position: pos,
      positionName: pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`)),
      columnSum: colSum,
      expectedDigit,
      actualDigit: sumDigit,
      carryIn: carry,
      carryOut: nextCarry,
      letters: [...new Set(lettersInCol)],
      digitValues
    });

    if (sumDigit !== null && expectedDigit !== sumDigit) {
      const uniqueLetters = [...new Set(lettersInCol)];
      const addendExpr = digitValues.slice(0, addends.length).join(' + ');
      return {
        valid: false,
        reason: `${pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`))}计算错误：` +
          `${addendExpr} + 进位${carry} = ${colSum}，` +
          `该位应为 ${expectedDigit}（进位 ${nextCarry}），` +
          `但 ${sumLetter}=${sumDigit} 不匹配，${sumLetter} 应该是 ${expectedDigit}`,
        errorLetters: uniqueLetters,
        errorType: 'column_mismatch',
        column: pos,
        columnName: pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`)),
        expectedDigit,
        actualDigit: sumDigit,
        problemLetter: sumLetter,
        columnDetails
      };
    }
    carry = nextCarry;
  }

  return null;
}

function analyzeSubtraction(base, terms, diffTerm, mapping, maxLen) {
  const minuend = terms[0];
  const subtrahend = terms[1];
  let borrow = 0;
  const columnDetails = [];

  for (let pos = 0; pos < maxLen + 2; pos++) {
    const lettersInCol = [];
    const digitValues = [];

    const mLetter = getTermLetterAt(minuend, pos);
    const mDigit = getTermDigit(minuend, pos, mapping, base);
    if (mLetter !== null) {
      lettersInCol.push(mLetter);
      digitValues.push(`${mLetter}=${mDigit !== null ? mDigit : '?'}`);
    }

    const sLetter = getTermLetterAt(subtrahend, pos);
    const sDigit = getTermDigit(subtrahend, pos, mapping, base);
    if (sLetter !== null) {
      lettersInCol.push(sLetter);
      digitValues.push(`${sLetter}=${sDigit !== null ? sDigit : '?'}`);
    }

    let diff = (mDigit || 0) - (sDigit || 0) - borrow;
    let nextBorrow = 0;
    if (diff < 0) {
      diff += base;
      nextBorrow = 1;
    }

    const dLetter = getTermLetterAt(diffTerm, pos);
    const dDigit = getTermDigit(diffTerm, pos, mapping, base);
    if (dLetter !== null) {
      lettersInCol.push(dLetter);
      digitValues.push(`${dLetter}=${dDigit !== null ? dDigit : '?'}`);
    }

    columnDetails.push({
      position: pos,
      positionName: pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`)),
      expectedDigit: diff,
      actualDigit: dDigit,
      borrowIn: borrow,
      borrowOut: nextBorrow,
      letters: [...new Set(lettersInCol)],
      digitValues
    });

    if (dDigit !== null && diff !== dDigit) {
      const uniqueLetters = [...new Set(lettersInCol)];
      return {
        valid: false,
        reason: `${pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`))}计算错误：` +
          `${mLetter || '0'}=${mDigit || 0} - ${sLetter || '0'}=${sDigit || 0} - 借位${borrow} = ${diff}（借位 ${nextBorrow}），` +
          `但 ${dLetter}=${dDigit} 不匹配，应为 ${diff}`,
        errorLetters: uniqueLetters,
        errorType: 'column_mismatch',
        column: pos,
        columnName: pos === 0 ? '个位' : (pos === 1 ? '十位' : (pos === 2 ? '百位' : `第${pos + 1}位`)),
        expectedDigit: diff,
        actualDigit: dDigit,
        problemLetter: dLetter,
        columnDetails
      };
    }
    borrow = nextBorrow;
  }

  return null;
}

function analyzeMultiplication(base, factors, productTerm, mapping, maxLen) {
  const generic = {
    errorLetters: factors.flatMap(t => t.split('')).filter(c => /[A-Z]/.test(c))
      .concat(productTerm.split('').filter(c => /[A-Z]/.test(c)))
  };
  return {
    ...generic,
    errorType: 'multiplication_mismatch'
  };
}

function genericAnalyze(base, tokensLeft, tokensRight, mapping, allTerms) {
  const letters = [];
  for (const term of allTerms) {
    for (const ch of term) {
      if (/[A-Z]/.test(ch)) letters.push(ch);
    }
  }
  return { errorLetters: [...new Set(letters)], errorType: 'generic_mismatch' };
}

function validateSolution(base, expression, mapping) {
  const upperMapping = {};
  for (const key in mapping) {
    upperMapping[key.toUpperCase()] = mapping[key];
  }

  const uniqueCheck = validateMappingUnique(upperMapping);
  if (!uniqueCheck.valid) {
    return {
      valid: false,
      reason: uniqueCheck.reason,
      errorLetters: uniqueCheck.errorLetters || [],
      errorType: uniqueCheck.errorType || 'duplicate'
    };
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
    if (foundEqual) rightTokens.push(tok);
    else leftTokens.push(tok);
  }

  if (!foundEqual) {
    return { valid: false, reason: '算式中缺少等号', errorLetters: [], errorType: 'missing_equal' };
  }

  for (const tok of [...leftTokens, ...rightTokens]) {
    if (tok.type === 'term') {
      const r = termToNumber(tok.value, upperMapping, base);
      if (!r.valid) {
        return {
          valid: false,
          reason: r.reason,
          errorLetters: r.errorLetters || [],
          errorType: r.errorType || 'term_error'
        };
      }
    }
  }

  const leftResult = evaluateSimple(leftTokens, upperMapping, base);
  if (!leftResult.valid) {
    return {
      valid: false,
      reason: leftResult.reason,
      errorLetters: leftResult.errorLetters || [],
      errorType: leftResult.errorType || 'eval_error'
    };
  }

  const rightResult = evaluateSimple(rightTokens, upperMapping, base);
  if (!rightResult.valid) {
    return {
      valid: false,
      reason: rightResult.reason,
      errorLetters: rightResult.errorLetters || [],
      errorType: rightResult.errorType || 'eval_error'
    };
  }

  if (leftResult.value !== rightResult.value) {
    const detailed = analyzeColumnByColumn(base, leftTokens, rightTokens, upperMapping);
    const columnInfo = detailed && detailed.column
      ? `（${detailed.columnName}出错）`
      : '';

    return {
      valid: false,
      reason: detailed
        ? detailed.reason
        : `等式不成立：左边=${leftResult.value}，右边=${rightResult.value}${columnInfo}`,
      errorLetters: (detailed && detailed.errorLetters) || [],
      errorType: (detailed && detailed.errorType) || 'mismatch',
      column: detailed ? detailed.column : undefined,
      columnName: detailed ? detailed.columnName : undefined,
      expectedDigit: detailed ? detailed.expectedDigit : undefined,
      actualDigit: detailed ? detailed.actualDigit : undefined,
      problemLetter: detailed ? detailed.problemLetter : undefined,
      leftValue: leftResult.value,
      rightValue: rightResult.value
    };
  }

  return { valid: true };
}

module.exports = { validateSolution, tokenizeExpression, toNumber };
