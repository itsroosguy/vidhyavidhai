import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, MapPin } from 'lucide-react';
import type { AppConfiguration, SchoolRecord, SessionFormValues } from '../../types/domain';
import { getBlocksForDistrict } from '../../validations/sessionValidation';

interface Section3Props {
  values: SessionFormValues;
  config: AppConfiguration;
  isComplete?: boolean;
  errorMap: Record<string, string>;
  matchedSchool: SchoolRecord | null;
  onUpdate: <K extends keyof SessionFormValues>(field: K, value: SessionFormValues[K]) => void;
  onDistrictChange: (district: string) => void;
  onApplyMatchedSchool: (school: SchoolRecord) => void;
}

export const Section3AboutSchool: React.FC<Section3Props> = ({
  values,
  config,
  isComplete = false,
  errorMap,
  matchedSchool,
  onUpdate,
  onDistrictChange,
  onApplyMatchedSchool,
}) => {
  const [blockSearch, setBlockSearch] = useState('');
  const districtBlocks = getBlocksForDistrict(values.district, config);
  const filteredBlocks = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    if (!q) return districtBlocks;
    return districtBlocks.filter((b) => b.toLowerCase().includes(q));
  }, [blockSearch, districtBlocks]);

  const districtSelectedWithoutBlocks =
    Boolean(values.district) && districtBlocks.length === 0;

  const schoolNameConflict =
    matchedSchool &&
    values.schoolName.trim() !== '' &&
    matchedSchool.schoolName.trim().toLowerCase() !== values.schoolName.trim().toLowerCase();

  const udiseDigits = values.udiseCode.length;
  const pinDigits = values.pinCode.length;

  return (
    <section
      id="section-3"
      tabIndex={-1}
      aria-labelledby="sec3-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Building2 className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec3-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0F172A]">
                About the school
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#475569] mt-0.5">
              11-digit UDISE auto-lookup and approved Tamil Nadu district &amp; block mapping
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[#F8FAFC] border border-[#CBD5E1] text-[#475569]">
          <MapPin className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
          {values.district ? `${values.district}${values.block ? ` · ${values.block}` : ''}` : 'Tamil Nadu'}
        </span>
      </div>

      {/* Bento Well 1 — School Identity & 11-digit UDISE */}
      <div className="ct-bento-well p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {/* School name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="schoolName" className="text-sm font-medium text-[#0F172A]">
            School name
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="schoolName"
            name="schoolName"
            type="text"
            required
            value={values.schoolName}
            onChange={(e) => onUpdate('schoolName', e.target.value)}
            onBlur={(e) => onUpdate('schoolName', e.target.value.trim())}
            aria-invalid={Boolean(errorMap.schoolName)}
            aria-describedby={errorMap.schoolName ? 'schoolName-error' : undefined}
            data-error="schoolName-error"
            className="ct-input"
          />
          {errorMap.schoolName && (
            <p id="schoolName-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.schoolName}
            </p>
          )}
        </div>

        {/* School code (UDISE) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="udiseCode" className="text-sm font-medium text-[#0F172A]">
              School code (UDISE)
              <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                *
              </span>
            </label>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ct-num font-medium ${
                udiseDigits === 11
                  ? 'bg-[#ECFDF5] text-[#047857] border border-[#047857]/35'
                  : 'bg-[#FFFFFF] text-[#526077] border border-[#CBD5E1]'
              }`}
            >
              {udiseDigits}/11
            </span>
          </div>
          <input
            id="udiseCode"
            name="udiseCode"
            type="text"
            inputMode="numeric"
            required
            maxLength={11}
            pattern="\d{11}"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="11 digits"
            aria-invalid={Boolean(errorMap.udiseCode)}
            aria-describedby={
              errorMap.udiseCode ? 'udise-hint udiseCode-error' : 'udise-hint'
            }
            value={values.udiseCode}
            onChange={(e) => {
              const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 11);
              onUpdate('udiseCode', digitsOnly);
            }}
            data-error="udiseCode-error"
            className="ct-input font-mono tracking-wider ct-num"
          />
          {/* 11-segment digit fill bar */}
          <div aria-hidden="true" className="grid grid-cols-11 gap-1 pt-0.5">
            {Array.from({ length: 11 }, (_, idx) => (
              <span
                key={idx}
                className={`h-1 rounded-full transition-colors ${
                  idx < udiseDigits
                    ? udiseDigits === 11
                      ? 'bg-[#047857]'
                      : 'bg-[#0F766E]'
                    : 'bg-[#E2E8F0]'
                }`}
              />
            ))}
          </div>
          <p id="udise-hint" className="text-xs text-[#526077]">
            The 11-digit number on the school records. Ask the headmaster or the office.
          </p>
          {errorMap.udiseCode && (
            <p id="udiseCode-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.udiseCode}
            </p>
          )}
        </div>

        {/* What kind of school is it? */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="schoolType" className="text-sm font-medium text-[#0F172A]">
            What kind of school is it?
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="schoolType"
            name="schoolType"
            required
            value={values.schoolType}
            onChange={(e) => onUpdate('schoolType', e.target.value)}
            aria-invalid={Boolean(errorMap.schoolType)}
            aria-describedby={errorMap.schoolType ? 'schoolType-error' : undefined}
            data-error="schoolType-error"
            className="ct-input ct-select"
          >
            <option value="">Choose...</option>
            {config.schoolTypes.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          {errorMap.schoolType && (
            <p id="schoolType-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.schoolType}
            </p>
          )}
        </div>
      </div>

      {/* Matched school UDISE helper */}
      {matchedSchool && (
        <div
          className={`mt-4 p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
            schoolNameConflict
              ? 'bg-[#FFFBEB] border-[#B45309]/40 text-[#0F172A]'
              : 'bg-[#E6F6F4] border-[#0F766E]/35 text-[#0F172A]'
          }`}
        >
          <div className="flex items-start gap-2">
            {schoolNameConflict ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
            ) : (
              <Building2 className="w-4 h-4 shrink-0 mt-0.5 text-[#0F766E]" aria-hidden="true" />
            )}
            <div>
              <span className="font-medium">Existing UDISE record found:</span>{' '}
              {matchedSchool.schoolName} ({matchedSchool.district}
              {matchedSchool.block ? ` · ${matchedSchool.block}` : ''}, PIN {matchedSchool.pinCode})
              {schoolNameConflict && (
                <p className="mt-0.5 text-[#92400E]">
                  Entered school name differs from the registered UDISE record. Existing school master
                  will not be overwritten; administrators will be flagged to review.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onApplyMatchedSchool(matchedSchool)}
            className="ct-btn-primary text-xs min-h-[34px] px-3 py-1"
          >
            Fill school details
          </button>
        </div>
      )}

      {/* Bento Well 2 — State | District | PIN code | Block */}
      <div className="ct-bento-well mt-4 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="state" className="text-sm font-medium text-[#0F172A]">
              State
            </label>
            <input
              id="state"
              name="state"
              type="text"
              readOnly
              value={values.state}
              className="ct-input"
            />
          </div>

          {/* District (ONLY approved 3 districts) */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="district" className="text-sm font-medium text-[#0F172A]">
              District
              <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                *
              </span>
            </label>
            <select
              id="district"
              name="district"
              required
              value={values.district}
              onChange={(e) => {
                setBlockSearch('');
                onDistrictChange(e.target.value);
              }}
              aria-invalid={Boolean(errorMap.district)}
              aria-describedby={errorMap.district ? 'district-error' : undefined}
              data-error="district-error"
              className="ct-input ct-select"
            >
              <option value="">Choose...</option>
              {config.allowedDistricts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {errorMap.district && (
              <p id="district-error" className="text-xs text-[#BE123C] font-medium">
                {errorMap.district}
              </p>
            )}
          </div>

          {/* PIN code */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="pinCode" className="text-sm font-medium text-[#0F172A]">
                PIN code
                <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                  *
                </span>
              </label>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full ct-num font-medium ${
                  pinDigits === 6
                    ? 'bg-[#ECFDF5] text-[#047857] border border-[#047857]/35'
                    : 'bg-[#FFFFFF] text-[#526077] border border-[#CBD5E1]'
                }`}
              >
                {pinDigits}/6
              </span>
            </div>
            <input
              id="pinCode"
              name="pinCode"
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              pattern="\d{6}"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="postal-code"
              placeholder="6 digits"
              value={values.pinCode}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                onUpdate('pinCode', digits);
              }}
              aria-invalid={Boolean(errorMap.pinCode)}
              aria-describedby={errorMap.pinCode ? 'pinCode-error' : undefined}
              data-error="pinCode-error"
              className="ct-input font-mono tracking-wider ct-num"
            />
            {/* 6-segment PIN fill bar */}
            <div aria-hidden="true" className="grid grid-cols-6 gap-1 pt-0.5">
              {Array.from({ length: 6 }, (_, idx) => (
                <span
                  key={idx}
                  className={`h-1 rounded-full transition-colors ${
                    idx < pinDigits
                      ? pinDigits === 6
                        ? 'bg-[#047857]'
                        : 'bg-[#0F766E]'
                      : 'bg-[#E2E8F0]'
                  }`}
                />
              ))}
            </div>
            {errorMap.pinCode && (
              <p id="pinCode-error" className="text-xs text-[#BE123C] font-medium">
                {errorMap.pinCode}
              </p>
            )}
          </div>
        </div>

        {/* Dependent Block row */}
        {(values.district || errorMap.block) && (
          <div className="mt-4 pt-3.5 border-t border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="block" className="text-sm font-medium text-[#0F172A]">
                Block ({values.district || 'Approved District'})
                <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="block"
                name="block"
                required
                disabled={!values.district || districtBlocks.length === 0}
                value={values.block}
                onChange={(e) => onUpdate('block', e.target.value)}
                aria-invalid={Boolean(errorMap.block)}
                aria-describedby={errorMap.block ? 'block-error' : undefined}
                data-error="block-error"
                className="ct-input ct-select"
              >
                <option value="">
                  {!values.district
                    ? 'Select district first...'
                    : districtBlocks.length === 0
                      ? 'No blocks configured'
                      : 'Choose...'}
                </option>
                {filteredBlocks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              {districtSelectedWithoutBlocks && (
                <p role="alert" className="text-xs text-[#B45309] font-medium">
                  Block list not configured. Please contact the administrator.
                </p>
              )}
              {!districtSelectedWithoutBlocks && errorMap.block && (
                <p id="block-error" className="text-xs text-[#BE123C] font-medium">
                  {errorMap.block}
                </p>
              )}
            </div>

            {districtBlocks.length > 8 && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="blockSearchFilter" className="text-sm font-medium text-[#0F172A]">
                  Search blocks in {values.district}
                </label>
                <input
                  id="blockSearchFilter"
                  type="search"
                  placeholder="Filter block list..."
                  value={blockSearch}
                  onChange={(e) => setBlockSearch(e.target.value)}
                  className="ct-input"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
